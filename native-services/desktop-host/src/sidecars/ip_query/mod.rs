//! IP 归属查询长驻 sidecar（Phase 4，`ip-query-serve`）。
//!
//! 迁移 JS `src/main/system-info/ip-query.js` 的网络竞速与缓存路径：
//!  - NDJSON 控制消息（camelCase），单进程承载全部查询；
//!  - 内存缓存跨请求存在：LRU + TTL + stale-while-revalidate；
//!  - 供应商竞速：首个成功结果胜出并取消其余候选请求；
//!  - 代理快照经 `updateProxy` 更新，密钥经 stdin `updateKeys` 更新（不记录含密钥 URL）。

use std::collections::{HashMap, VecDeque};
use std::io::Write;
use std::time::{Duration, Instant};

use serde::Deserialize;
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio_util::sync::CancellationToken;

use crate::shared::network::{ProxyConfig, PROXY_HANDSHAKE_TIMEOUT};

pub const IP_QUERY_SCHEMA_VERSION: u32 = 1;
/// 单个候选请求超时（与 JS fetchIpInfo timeout 一致）
const REQUEST_TIMEOUT_MS: u64 = 5000;
/// 单次查询总截止时间（覆盖全部候选请求的竞速）
const QUERY_DEADLINE_MS: u64 = 8000;
/// 缓存默认值（与 JS 保持一致，可用环境变量覆盖）
const DEFAULT_CACHE_TTL_MS: u64 = 300_000;
const DEFAULT_CACHE_MAX: usize = 200;

fn cache_ttl_ms() -> u64 {
    std::env::var("IPQUERY_CACHE_TTL_MS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(DEFAULT_CACHE_TTL_MS)
}

fn cache_max() -> usize {
    std::env::var("IPQUERY_CACHE_MAX")
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(DEFAULT_CACHE_MAX)
}

// ---------------------------------------------------------------------------
// 供应商表（与 JS IP_API_PROVIDERS / KEY_API_PROVIDERS 行为一致）
// ---------------------------------------------------------------------------

struct Provider {
    name: &'static str,
    own: bool,
    lookup: bool,
    keyed: bool,
    /// ip 为 None 表示查本机出口 IP；key 仅 keyed 供应商使用
    url: fn(ip: Option<&str>, key: Option<&str>) -> String,
    transform: fn(data: &Value, ip: Option<&str>) -> Result<Value, String>,
}

/// 过滤 location 数组中的空值（对应 JS `.filter(Boolean)`）
fn location_parts(values: Vec<Value>) -> Vec<Value> {
    values
        .into_iter()
        .filter(|value| match value {
            Value::Null => false,
            Value::String(text) => !text.is_empty(),
            Value::Number(_) => true,
            _ => false,
        })
        .collect()
}

fn f64_at(data: &Value, keys: &[&str]) -> Option<Value> {
    let mut current = data;
    for key in keys {
        current = current.get(*key)?;
    }
    match current {
        Value::Null => None,
        other => Some(other.clone()),
    }
}

fn opt_str<'a>(data: &'a Value, keys: &[&str]) -> Option<&'a str> {
    let mut current = data;
    for key in keys {
        current = current.get(*key)?;
    }
    current.as_str()
}

fn opt_f64(data: &Value, keys: &[&str]) -> Option<Value> {
    f64_at(data, keys).and_then(|value| match value {
        Value::Number(number) => Some(Value::Number(number)),
        Value::String(text) => text
            .parse::<f64>()
            .ok()
            .and_then(|parsed| serde_json::Number::from_f64(parsed))
            .map(Value::Number),
        _ => None,
    })
}

fn ok_result(
    ip: &Value,
    location: Vec<Value>,
    latitude: Option<Value>,
    longitude: Option<Value>,
) -> Value {
    let mut data = json!({ "ip": ip, "location": location_parts(location) });
    if let Some(lat) = latitude {
        data["latitude"] = lat;
    }
    if let Some(lng) = longitude {
        data["longitude"] = lng;
    }
    json!({ "ret": "ok", "data": data })
}

fn transform_geolocation_db(data: &Value, ip: Option<&str>) -> Result<Value, String> {
    if data.get("IPv4").is_none() {
        return Err("geolocation-db.com invalid response".to_string());
    }
    let resolved_ip = data
        .get("IPv4")
        .cloned()
        .or_else(|| ip.map(|value| json!(value)))
        .unwrap_or(Value::Null);
    Ok(ok_result(
        &resolved_ip,
        vec![
            data.get("country_name").cloned().unwrap_or(Value::Null),
            data.get("state").cloned().unwrap_or(Value::Null),
            data.get("city").cloned().unwrap_or(Value::Null),
        ],
        opt_f64(data, &["latitude"]),
        opt_f64(data, &["longitude"]),
    ))
}

fn transform_myip_ipip(data: &Value, _ip: Option<&str>) -> Result<Value, String> {
    if data.get("ret").and_then(Value::as_str) != Some("ok") {
        return Err("myip.ipip.net API error".to_string());
    }
    let inner = data.get("data").ok_or("myip.ipip.net invalid response")?;
    let location = inner
        .get("location")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    Ok(json!({
        "ret": "ok",
        "data": {
            "ip": inner.get("ip").cloned().unwrap_or(Value::Null),
            "location": location_parts(location),
        }
    }))
}

fn transform_ipwhois(data: &Value, ip: Option<&str>) -> Result<Value, String> {
    if data.get("success") == Some(&Value::Bool(false)) {
        let message = data.get("message").and_then(Value::as_str).unwrap_or("");
        return Err(format!("ipwho.is API error: {message}"));
    }
    let resolved_ip = data
        .get("ip")
        .cloned()
        .or_else(|| ip.map(|value| json!(value)))
        .unwrap_or(Value::Null);
    let org = opt_str(data, &["org"])
        .or_else(|| opt_str(data, &["isp"]))
        .map(|value| json!(value))
        .unwrap_or(Value::Null);
    Ok(ok_result(
        &resolved_ip,
        vec![
            data.get("country").cloned().unwrap_or(Value::Null),
            data.get("region").cloned().unwrap_or(Value::Null),
            data.get("city").cloned().unwrap_or(Value::Null),
            org,
        ],
        opt_f64(data, &["latitude"]),
        opt_f64(data, &["longitude"]),
    ))
}

fn transform_ipinfo(data: &Value, ip: Option<&str>) -> Result<Value, String> {
    if data.get("error").is_some_and(|error| !error.is_null()) {
        let title = data
            .pointer("/error/title")
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        return Err(format!("ipinfo.io API error: {title}"));
    }
    let loc_parts: Vec<f64> = data
        .get("loc")
        .and_then(Value::as_str)
        .map(|loc| {
            loc.split(',')
                .filter_map(|part| part.trim().parse::<f64>().ok())
                .collect()
        })
        .unwrap_or_default();
    let resolved_ip = data
        .get("ip")
        .cloned()
        .or_else(|| ip.map(|value| json!(value)))
        .unwrap_or(Value::Null);
    let org = opt_str(data, &["org"])
        .or_else(|| opt_str(data, &["isp"]))
        .map(|value| json!(value))
        .unwrap_or(Value::Null);
    Ok(ok_result(
        &resolved_ip,
        vec![
            data.get("country").cloned().unwrap_or(Value::Null),
            data.get("region").cloned().unwrap_or(Value::Null),
            data.get("city").cloned().unwrap_or(Value::Null),
            org,
        ],
        loc_parts
            .first()
            .and_then(|value| serde_json::Number::from_f64(*value))
            .map(Value::Number),
        loc_parts
            .get(1)
            .and_then(|value| serde_json::Number::from_f64(*value))
            .map(Value::Number),
    ))
}

fn transform_ipapi_co(data: &Value, ip: Option<&str>) -> Result<Value, String> {
    if data.get("error").is_some_and(|error| !error.is_null()) {
        let reason = data
            .get("reason")
            .or_else(|| data.get("error"))
            .map(|value| value.to_string())
            .unwrap_or_else(|| "unknown".to_string());
        return Err(format!("ipapi.co API error: {reason}"));
    }
    let resolved_ip = data
        .get("ip")
        .cloned()
        .or_else(|| ip.map(|value| json!(value)))
        .unwrap_or(Value::Null);
    Ok(ok_result(
        &resolved_ip,
        vec![
            data.get("country_name").cloned().unwrap_or(Value::Null),
            data.get("region").cloned().unwrap_or(Value::Null),
            data.get("city").cloned().unwrap_or(Value::Null),
            data.get("org").cloned().unwrap_or(Value::Null),
        ],
        opt_f64(data, &["latitude"]),
        opt_f64(data, &["longitude"]),
    ))
}

fn transform_vore_top(data: &Value, ip: Option<&str>) -> Result<Value, String> {
    if data.get("code").and_then(Value::as_i64) != Some(200) {
        let msg = data.get("msg").and_then(Value::as_str).unwrap_or("");
        return Err(format!("api.vore.top API error: {msg}"));
    }
    let info = data.pointer("/data/ipInfo").cloned().unwrap_or(Value::Null);
    let latlng: Vec<f64> = info
        .get("latlng")
        .and_then(Value::as_array)
        .map(|values| values.iter().filter_map(Value::as_f64).collect())
        .unwrap_or_default();
    let resolved_ip = data
        .pointer("/data/ip")
        .cloned()
        .or_else(|| ip.map(|value| json!(value)))
        .unwrap_or(Value::Null);
    Ok(ok_result(
        &resolved_ip,
        vec![
            info.get("country").cloned().unwrap_or(Value::Null),
            info.get("province").cloned().unwrap_or(Value::Null),
            info.get("city").cloned().unwrap_or(Value::Null),
            info.get("isp").cloned().unwrap_or(Value::Null),
        ],
        latlng
            .first()
            .and_then(|value| serde_json::Number::from_f64(*value))
            .map(Value::Number),
        latlng
            .get(1)
            .and_then(|value| serde_json::Number::from_f64(*value))
            .map(Value::Number),
    ))
}

fn transform_pconline(data: &Value, ip: Option<&str>) -> Result<Value, String> {
    if data.get("err").is_some_and(|error| !error.is_null()) {
        let err = data.get("err").and_then(Value::as_str).unwrap_or("");
        return Err(format!("pconline API error: {err}"));
    }
    let resolved_ip = data
        .get("ip")
        .cloned()
        .or_else(|| ip.map(|value| json!(value)))
        .unwrap_or(Value::Null);
    Ok(json!({
        "ret": "ok",
        "data": {
            "ip": resolved_ip,
            "location": location_parts(vec![
                data.get("pro").cloned().unwrap_or(Value::Null),
                data.get("city").cloned().unwrap_or(Value::Null),
                data.get("addr").cloned().unwrap_or(Value::Null),
            ]),
        }
    }))
}

fn transform_useragentinfo(data: &Value, ip: Option<&str>) -> Result<Value, String> {
    let resolved_ip = data
        .get("ip")
        .cloned()
        .or_else(|| ip.map(|value| json!(value)))
        .unwrap_or(Value::Null);
    Ok(json!({
        "ret": "ok",
        "data": {
            "ip": resolved_ip,
            "location": location_parts(vec![
                data.get("country").cloned().unwrap_or(Value::Null),
                data.get("province").cloned().unwrap_or(Value::Null),
                data.get("city").cloned().unwrap_or(Value::Null),
                data.get("isp").cloned().unwrap_or(Value::Null),
            ]),
        }
    }))
}

fn transform_ip_api_com(data: &Value, ip: Option<&str>) -> Result<Value, String> {
    let resolved_ip = data
        .get("query")
        .cloned()
        .or_else(|| ip.map(|value| json!(value)))
        .unwrap_or(Value::Null);
    let org = opt_str(data, &["isp"])
        .or_else(|| opt_str(data, &["org"]))
        .map(|value| json!(value))
        .unwrap_or(Value::Null);
    Ok(ok_result(
        &resolved_ip,
        vec![
            data.get("country").cloned().unwrap_or(Value::Null),
            data.get("regionName").cloned().unwrap_or(Value::Null),
            data.get("city").cloned().unwrap_or(Value::Null),
            org,
        ],
        opt_f64(data, &["lat"]),
        opt_f64(data, &["lon"]),
    ))
}

fn transform_freegeoip(data: &Value, ip: Option<&str>) -> Result<Value, String> {
    let resolved_ip = data
        .get("ip")
        .cloned()
        .or_else(|| ip.map(|value| json!(value)))
        .unwrap_or(Value::Null);
    let org = opt_str(data, &["isp"])
        .or_else(|| opt_str(data, &["organization_name"]))
        .map(|value| json!(value))
        .unwrap_or(Value::Null);
    Ok(ok_result(
        &resolved_ip,
        vec![
            data.get("country_name").cloned().unwrap_or(Value::Null),
            data.get("region_name").cloned().unwrap_or(Value::Null),
            data.get("city").cloned().unwrap_or(Value::Null),
            org,
        ],
        opt_f64(data, &["latitude"]),
        opt_f64(data, &["longitude"]),
    ))
}

fn transform_ip_sb(data: &Value, ip: Option<&str>) -> Result<Value, String> {
    let resolved_ip = data
        .get("ip")
        .cloned()
        .or_else(|| ip.map(|value| json!(value)))
        .unwrap_or(Value::Null);
    Ok(ok_result(
        &resolved_ip,
        vec![
            data.get("country").cloned().unwrap_or(Value::Null),
            data.get("region").cloned().unwrap_or(Value::Null),
            data.get("city").cloned().unwrap_or(Value::Null),
            data.get("organization").cloned().unwrap_or(Value::Null),
        ],
        opt_f64(data, &["latitude"]),
        opt_f64(data, &["longitude"]),
    ))
}

fn transform_yaohud(data: &Value, ip: Option<&str>) -> Result<Value, String> {
    if data.get("code").and_then(Value::as_i64) != Some(200) {
        let msg = data.get("msg").and_then(Value::as_str).unwrap_or("");
        return Err(format!("Yaohud API error: {msg}"));
    }
    let inner = data.get("data").cloned().unwrap_or(Value::Null);
    let resolved_ip = inner
        .get("IP")
        .cloned()
        .or_else(|| ip.map(|value| json!(value)))
        .unwrap_or(Value::Null);
    Ok(ok_result(
        &resolved_ip,
        vec![
            inner.get("nation").cloned().unwrap_or(Value::Null),
            inner.get("Country").cloned().unwrap_or(Value::Null),
            inner.get("Local").cloned().unwrap_or(Value::Null),
        ],
        opt_f64(&inner, &["lat"]),
        opt_f64(&inner, &["lng"]),
    ))
}

fn transform_ip2location(data: &Value, ip: Option<&str>) -> Result<Value, String> {
    if data.get("error").is_some_and(|error| !error.is_null()) {
        let message = data
            .pointer("/error/error_message")
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        return Err(format!("ip2location.io API error: {message}"));
    }
    let resolved_ip = data
        .get("ip")
        .cloned()
        .or_else(|| ip.map(|value| json!(value)))
        .unwrap_or(Value::Null);
    Ok(ok_result(
        &resolved_ip,
        vec![
            data.get("country_name").cloned().unwrap_or(Value::Null),
            data.get("region_name").cloned().unwrap_or(Value::Null),
            data.get("city_name").cloned().unwrap_or(Value::Null),
            data.get("as").cloned().unwrap_or(Value::Null),
        ],
        opt_f64(data, &["latitude"]),
        opt_f64(data, &["longitude"]),
    ))
}

/// 静态供应商表：引用为 'static，供竞速任务安全捕获
static PROVIDERS: std::sync::LazyLock<Vec<Provider>> = std::sync::LazyLock::new(provider_list);

fn provider_list() -> Vec<Provider> {
    vec![
        Provider {
            name: "myip.ipip.net",
            own: true,
            lookup: false,
            keyed: false,
            url: |_ip, _key| "https://myip.ipip.net/json".to_string(),
            transform: transform_myip_ipip,
        },
        Provider {
            name: "geolocation-db.com",
            own: true,
            lookup: true,
            keyed: false,
            url: |ip, _key| match ip {
                Some(value) => format!("https://geolocation-db.com/json/{value}"),
                None => "https://geolocation-db.com/json/".to_string(),
            },
            transform: transform_geolocation_db,
        },
        Provider {
            name: "ipwho.is",
            own: true,
            lookup: true,
            keyed: false,
            url: |ip, _key| match ip {
                Some(value) => format!("https://ipwho.is/{value}"),
                None => "https://ipwho.is/".to_string(),
            },
            transform: transform_ipwhois,
        },
        Provider {
            name: "ipinfo.io",
            own: true,
            lookup: true,
            keyed: false,
            url: |ip, _key| match ip {
                Some(value) => format!("https://ipinfo.io/{value}/json"),
                None => "https://ipinfo.io/json".to_string(),
            },
            transform: transform_ipinfo,
        },
        Provider {
            name: "ipapi.co",
            own: true,
            lookup: true,
            keyed: false,
            url: |ip, _key| match ip {
                Some(value) => format!("https://ipapi.co/{value}/json/"),
                None => "https://ipapi.co/json/".to_string(),
            },
            transform: transform_ipapi_co,
        },
        Provider {
            name: "api.vore.top",
            own: true,
            lookup: true,
            keyed: false,
            url: |ip, _key| match ip {
                Some(value) => format!("https://api.vore.top/api/IPdata?ip={value}"),
                None => "https://api.vore.top/api/IPdata".to_string(),
            },
            transform: transform_vore_top,
        },
        Provider {
            name: "whois.pconline.com.cn",
            own: true,
            lookup: false,
            keyed: false,
            url: |_ip, _key| "https://whois.pconline.com.cn/ipJson.jsp?json=true".to_string(),
            transform: transform_pconline,
        },
        Provider {
            name: "ip.useragentinfo.com",
            own: true,
            lookup: false,
            keyed: false,
            url: |_ip, _key| "https://ip.useragentinfo.com/json".to_string(),
            transform: transform_useragentinfo,
        },
        Provider {
            name: "ip-api.com",
            own: false,
            lookup: true,
            keyed: false,
            url: |ip, _key| format!("https://ip-api.com/json/{}", ip.unwrap_or_default()),
            transform: transform_ip_api_com,
        },
        Provider {
            name: "freegeoip.live",
            own: false,
            lookup: true,
            keyed: false,
            url: |ip, _key| format!("https://freegeoip.live/json/{}", ip.unwrap_or_default()),
            transform: transform_freegeoip,
        },
        Provider {
            name: "ip.sb",
            own: false,
            lookup: true,
            keyed: false,
            url: |ip, _key| format!("https://api.ip.sb/geoip/{}", ip.unwrap_or_default()),
            transform: transform_ip_sb,
        },
        Provider {
            name: "yaohud.cn",
            own: false,
            lookup: true,
            keyed: false,
            url: |ip, _key| {
                format!(
                    "https://api.yaohud.cn/api/v5/geoip?ip={}",
                    ip.unwrap_or_default()
                )
            },
            transform: transform_yaohud,
        },
        Provider {
            name: "ip2location.io",
            own: false,
            lookup: true,
            keyed: true,
            url: |ip, key| {
                format!(
                    "https://api.ip2location.io/?key={}&ip={}",
                    key.unwrap_or_default(),
                    ip.unwrap_or_default()
                )
            },
            transform: transform_ip2location,
        },
    ]
}

// ---------------------------------------------------------------------------
// 缓存（LRU + TTL + SWR，语义与 JS 保持一致）
// ---------------------------------------------------------------------------

struct CacheEntry {
    ts: Instant,
    result: Value,
}

#[derive(Default)]
struct LruCache {
    map: HashMap<String, CacheEntry>,
    order: VecDeque<String>,
    max: usize,
}

impl LruCache {
    fn new(max: usize) -> Self {
        Self {
            map: HashMap::new(),
            order: VecDeque::new(),
            max,
        }
    }

    fn get(&mut self, key: &str) -> Option<&CacheEntry> {
        if self.map.contains_key(key) {
            // 移到最近
            self.order.retain(|entry| entry != key);
            self.order.push_back(key.to_string());
        }
        self.map.get(key)
    }

    fn put(&mut self, key: &str, result: Value) {
        if self.map.contains_key(key) {
            self.order.retain(|entry| entry != key);
        }
        self.order.push_back(key.to_string());
        self.map.insert(
            key.to_string(),
            CacheEntry {
                ts: Instant::now(),
                result,
            },
        );
        // LRU 淘汰
        while self.map.len() > self.max {
            if let Some(oldest) = self.order.pop_front() {
                self.map.remove(&oldest);
            } else {
                break;
            }
        }
    }
}

// ---------------------------------------------------------------------------
// sidecar 状态与协议
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
enum IpQueryInput {
    Query {
        #[serde(default)]
        request_id: Option<String>,
        #[serde(default)]
        ip: String,
        #[serde(default)]
        proxy: Option<ProxyConfig>,
    },
    UpdateProxy {
        #[serde(default)]
        request_id: Option<String>,
        #[serde(default)]
        proxy: Option<ProxyConfig>,
        #[serde(default)]
        revision: Option<u32>,
    },
    UpdateKeys {
        #[serde(default)]
        request_id: Option<String>,
        /// 供应商名 -> 密钥；仅内存保存，不落盘不记录
        #[serde(default)]
        keys: HashMap<String, String>,
        #[serde(default)]
        revision: Option<u32>,
    },
    Cancel {
        #[serde(default)]
        request_id: Option<String>,
        #[serde(default)]
        query_id: Option<String>,
    },
    Close {
        #[serde(default)]
        request_id: Option<String>,
    },
}

struct QueryState {
    cache: LruCache,
    proxy: Option<ProxyConfig>,
    proxy_revision: u32,
    keys: HashMap<String, String>,
    keys_revision: u32,
    queries: HashMap<String, CancellationToken>,
    refreshing: std::collections::HashSet<String>,
}

fn emit(payload: &Value) {
    let mut stdout = std::io::stdout().lock();
    let _ = serde_json::to_writer(&mut stdout, payload);
    let _ = stdout.write_all(b"\n");
    let _ = stdout.flush();
}

fn emit_event(kind: &str, extra: Value) {
    let mut payload = json!({
        "type": "event",
        "schemaVersion": IP_QUERY_SCHEMA_VERSION,
        "kind": kind,
    });
    if let (Some(object), Some(target)) = (payload.as_object_mut(), extra.as_object()) {
        for (key, value) in target {
            object.insert(key.clone(), value.clone());
        }
    }
    emit(&payload);
}

fn acknowledge(request_id: Option<&String>, extra: Value) {
    let Some(request_id) = request_id else {
        return;
    };
    let mut payload = json!({
        "type": "result",
        "schemaVersion": IP_QUERY_SCHEMA_VERSION,
        "requestId": request_id,
        "acknowledged": true,
    });
    if let (Some(object), Some(target)) = (payload.as_object_mut(), extra.as_object()) {
        for (key, value) in target {
            object.insert(key.clone(), value.clone());
        }
    }
    emit(&payload);
}

/// 构建缓存键：查询 IP + 代理快照版本 + 供应商配置版本。
/// 代理切换后版本变化，避免继续返回旧出口的「本机 IP」。
fn cache_key(ip: &str, proxy_revision: u32, keys_revision: u32) -> String {
    let trimmed = ip.trim();
    let base = if trimmed.is_empty() {
        "__MY_IP__"
    } else {
        trimmed
    };
    format!("{base}|p{proxy_revision}|k{keys_revision}")
}

/// 构建带代理的 reqwest 客户端。
/// 语义与 JS 保持一致：socks5 本地 DNS（socks5://，非 socks5h）；
/// http/https 标签都走普通 HTTP CONNECT（无 TLS 到代理）；
/// socks4 不受支持：明确报错，不直连。
fn build_client(proxy: Option<&ProxyConfig>) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder()
        .user_agent("SimpleShell-App")
        .timeout(Duration::from_millis(REQUEST_TIMEOUT_MS))
        .connect_timeout(PROXY_HANDSHAKE_TIMEOUT);

    if let Some(proxy) = proxy {
        if proxy.host.is_empty() || proxy.port == 0 {
            return Err("proxy host/port missing".to_string());
        }
        let auth = match (&proxy.username, &proxy.password) {
            (Some(user), Some(pass)) if !user.is_empty() => {
                format!("{user}:{pass}@")
            }
            (Some(user), None) if !user.is_empty() => format!("{user}:@"),
            _ => String::new(),
        };
        let scheme = if proxy.r#type == "socks5" {
            "socks5://"
        } else {
            // http/https：普通 HTTP CONNECT（与 JS 一致，无 TLS 到代理）
            "http://"
        };
        let proxy_url = format!("{scheme}{auth}{}:{}", proxy.host, proxy.port);
        let configured = match proxy.r#type.as_str() {
            "socks5" => reqwest::Proxy::all(&proxy_url),
            "socks4" => {
                // reqwest 不支持 socks4：不直连，交给上层回退
                return Err(format!(
                    "unsupported proxy type for ip query: {}",
                    proxy.r#type
                ));
            }
            // http/https：普通 TCP CONNECT（与 JS getPublicIp/fetchIpInfo 一致）
            "http" | "https" => reqwest::Proxy::all(&proxy_url),
            other => {
                return Err(format!("unsupported proxy type for ip query: {other}"));
            }
        };
        builder = builder.proxy(configured.map_err(|error| error.to_string())?);
    } else {
        // 显式禁用环境代理（显式直连策略）
        builder = builder.no_proxy();
    }
    builder.build().map_err(|error| error.to_string())
}

/// 单个候选请求：GET + transform。失败返回 Err（交由竞速挑选首个成功）。
async fn fetch_one(
    client: &reqwest::Client,
    provider: &Provider,
    ip: Option<&str>,
    key: Option<&str>,
) -> Result<Value, String> {
    let mut url = (provider.url)(ip, key);
    // 测试钩子：重写到本地 HTTP fixture（保留路径，附加 __provider 便于 fixture 分流）
    if let Ok(origin) = std::env::var("IPQUERY_TEST_ORIGIN") {
        if !origin.is_empty() {
            if let Some((_, rest)) = url.split_once("://") {
                let separator = if rest.contains('?') { "&" } else { "?" };
                url = format!("{origin}/{rest}{separator}__provider={}", provider.name);
            }
        }
    }
    let response = client
        .get(&url)
        .timeout(Duration::from_millis(REQUEST_TIMEOUT_MS))
        .send()
        .await
        .map_err(|error| format!("API {} request error: {error}", provider.name))?;
    if !response.status().is_success() {
        return Err(format!(
            "API {} HTTP Error: {}",
            provider.name,
            response.status().as_u16()
        ));
    }
    let text = response
        .text()
        .await
        .map_err(|error| format!("API {} reading error: {error}", provider.name))?;
    let data: Value = serde_json::from_str(&text)
        .map_err(|error| format!("API {} parsing error: {error}", provider.name))?;
    (provider.transform)(&data, ip)
        .map_err(|error| format!("API {} transform error: {error}", provider.name))
}

/// 竞速主循环：首个成功即取消其余候选并返回；全部失败返回最后错误。
async fn race_first_success(
    client: reqwest::Client,
    providers: Vec<&'static Provider>,
    ip: Option<String>,
    key: Option<String>,
    token: &CancellationToken,
) -> Result<(Value, &'static str), String> {
    if providers.is_empty() {
        return Err("no providers available".to_string());
    }
    let (sender, mut receiver) =
        tokio::sync::mpsc::channel::<(Result<Value, String>, &'static str)>(providers.len());
    for &provider in providers.iter() {
        let client = client.clone();
        let sender = sender.clone();
        let ip = ip.clone();
        let key = key.clone();
        let token = token.clone();
        let name = provider.name;
        tokio::spawn(async move {
            let result = tokio::select! {
                _ = token.cancelled() => (Err("cancelled".to_string()), name),
                r = fetch_one(&client, provider, ip.as_deref(), key.as_deref()) => (r, name),
            };
            let _ = sender.send(result).await;
        });
    }
    drop(sender);

    let mut last_error = String::from("all providers failed");
    let expected = providers.len();
    let mut received = 0usize;
    let _ = providers.iter().count();
    while received < expected {
        let message = tokio::select! {
            _ = token.cancelled() => return Err("cancelled".to_string()),
            _ = tokio::time::sleep(Duration::from_millis(QUERY_DEADLINE_MS)) => {
                return Err(format!("query deadline exceeded; last error: {last_error}"));
            }
            message = receiver.recv() => match message {
                Some(message) => message,
                None => return Err(last_error),
            },
        };
        received += 1;
        match message {
            (Ok(value), name) => {
                // 首个成功胜出：取消其余候选请求
                token.cancel();
                // 排空剩余响应，避免悬挂任务
                while receiver.try_recv().is_ok() {}
                return Ok((value, name));
            }
            (Err(error), name) => {
                if error != "cancelled" {
                    last_error = format!("{name}: {error}");
                }
            }
        }
    }
    Err(last_error)
}

/// 执行一次网络查询（own 或 lookup 路径），含缓存/SWR 语义。
/// 查询结果元数据（事件与确认共用）
struct QueryOutcome {
    result: Value,
    cached: bool,
    stale: bool,
    provider: Option<&'static str>,
}

async fn perform_query(
    state: &std::sync::Arc<tokio::sync::Mutex<QueryState>>,
    ip: &str,
) -> QueryOutcome {
    let (key, proxy_snapshot, _proxy_revision, keys_snapshot, _keys_revision, has_key_provider) = {
        let state = state.lock().await;
        (
            cache_key(ip, state.proxy_revision, state.keys_revision),
            state.proxy.clone(),
            state.proxy_revision,
            state.keys.clone(),
            state.keys_revision,
            state.keys.contains_key("ip2location"),
        )
    };

    // 缓存查询
    let entry = {
        let mut state = state.lock().await;
        state
            .cache
            .get(&key)
            .map(|entry| (entry.ts, entry.result.clone()))
    };
    let now = Instant::now();
    let ttl = Duration::from_millis(cache_ttl_ms());
    if let Some((ts, result)) = &entry {
        if now.duration_since(*ts) < ttl {
            return QueryOutcome {
                result: result.clone(),
                cached: true,
                stale: false,
                provider: None,
            };
        }
    }

    let should_serve_stale = entry.is_some();

    // SWR：后台刷新（同键仅允许一次在途刷新），先返回旧值
    if should_serve_stale {
        let spawning = {
            let mut state = state.lock().await;
            if state.refreshing.contains(&key) {
                false
            } else {
                state.refreshing.insert(key.clone());
                true
            }
        };
        if spawning {
            let state = state.clone();
            let ip = ip.to_string();
            let refresh_key = key.clone();
            tokio::spawn(async move {
                let result = run_network_query(&state, &ip).await;
                let mut state = state.lock().await;
                state.refreshing.remove(&refresh_key);
                if let Some(value) = result {
                    // 后台刷新完成时按当前版本写回；失败不替换仍可用的成功条目
                    let write_key = cache_key(&ip, state.proxy_revision, state.keys_revision);
                    state.cache.put(&write_key, value);
                }
            });
        }
        if let Some((_, result)) = &entry {
            return QueryOutcome {
                result: result.clone(),
                cached: true,
                stale: true,
                provider: None,
            };
        }
    }

    // 网络查询
    let query_id = uuid_like();
    let token = CancellationToken::new();
    {
        let mut state = state.lock().await;
        state.queries.insert(query_id.clone(), token.clone());
    }
    let network = run_network_query_with(
        &proxy_snapshot,
        &keys_snapshot,
        has_key_provider,
        ip,
        &token,
    )
    .await;
    {
        let mut state = state.lock().await;
        state.queries.remove(&query_id);
    }
    match network {
        Some((result, provider)) => {
            {
                let mut state = state.lock().await;
                state.cache.put(&key, result.clone());
            }
            QueryOutcome {
                result,
                cached: false,
                stale: false,
                provider: Some(provider),
            }
        }
        None => QueryOutcome {
            result: json!({
                "ret": "failed",
                "msg": "all IP query providers failed",
            }),
            cached: false,
            stale: false,
            provider: None,
        },
    }
}

/// 生成简单唯一 ID（无需外部 uuid 依赖）
fn uuid_like() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_nanos())
        .unwrap_or(0);
    format!("q-{nanos}-{}", std::process::id())
}

/// 网络查询：own 路径（先竞速 own 供应商，失败则先取出口 IP 再查归属）或 lookup 路径。
/// 返回 (结果, 供应商名)；全部失败返回 None。
async fn run_network_query_with(
    proxy: &Option<ProxyConfig>,
    keys: &HashMap<String, String>,
    has_key_provider: bool,
    ip: &str,
    token: &CancellationToken,
) -> Option<(Value, &'static str)> {
    let client = match build_client(proxy.as_ref()) {
        Ok(client) => client,
        Err(_error) => {
            return None;
        }
    };
    let providers: &'static [Provider] = &PROVIDERS;
    let trimmed = ip.trim();

    if !trimmed.is_empty() {
        // lookup 路径
        let lookup: Vec<&Provider> = providers
            .iter()
            .filter(|provider| provider.lookup && (!provider.keyed || has_key_provider))
            .collect();
        let key = keys.get("ip2location").cloned();
        let result =
            race_first_success(client, lookup, Some(trimmed.to_string()), key, token).await;
        return result.ok();
    }

    // own 路径：先竞速 own 供应商
    let own: Vec<&Provider> = providers
        .iter()
        .filter(|provider| provider.own && (!provider.keyed || has_key_provider))
        .collect();
    if let Ok((result, name)) = race_first_success(client.clone(), own, None, None, token).await {
        return Some((result, name));
    }

    // 全部 own 供应商失败：先取出口 IP，再查归属
    let public_ip = fetch_public_ip(&client, token).await?;
    let lookup: Vec<&Provider> = providers
        .iter()
        .filter(|provider| provider.lookup && (!provider.keyed || has_key_provider))
        .collect();
    let key = keys.get("ip2location").cloned();
    let (result, name) = race_first_success(client, lookup, Some(public_ip), key, token)
        .await
        .ok()?;
    Some((result, name))
}

/// 出口 IP 查询（api.ip.sb /ip，与 JS getPublicIp 一致）
async fn fetch_public_ip(client: &reqwest::Client, token: &CancellationToken) -> Option<String> {
    let request = client
        .get("https://api.ip.sb/ip")
        .timeout(Duration::from_millis(REQUEST_TIMEOUT_MS));
    let response = tokio::select! {
        _ = token.cancelled() => return None,
        r = request.send() => r.ok()?,
    };
    if !response.status().is_success() {
        return None;
    }
    let text = response.text().await.ok()?;
    let trimmed = text.trim().to_string();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

async fn run_network_query(
    state: &std::sync::Arc<tokio::sync::Mutex<QueryState>>,
    ip: &str,
) -> Option<Value> {
    let (proxy_snapshot, keys_snapshot, has_key_provider) = {
        let state = state.lock().await;
        (
            state.proxy.clone(),
            state.keys.clone(),
            state.keys.contains_key("ip2location"),
        )
    };
    let token = CancellationToken::new();
    run_network_query_with(
        &proxy_snapshot,
        &keys_snapshot,
        has_key_provider,
        ip,
        &token,
    )
    .await
    .map(|(value, _)| value)
}

/// 处理单条输入消息
async fn handle_input(state: &std::sync::Arc<tokio::sync::Mutex<QueryState>>, input: IpQueryInput) {
    match input {
        IpQueryInput::Query {
            request_id,
            ip,
            proxy,
        } => {
            // 请求内可携带代理快照（与查询一起原子生效）
            if let Some(proxy) = proxy {
                let mut state_lock = state.lock().await;
                state_lock.proxy = Some(proxy);
                state_lock.proxy_revision += 1;
            }
            // 并发执行查询（requestId 关联），使 cancel 能在查询期间插入
            let state = state.clone();
            tokio::spawn(async move {
                let outcome = perform_query(&state, &ip).await;
                emit_event(
                    "result",
                    json!({
                        "requestId": request_id,
                        "result": outcome.result,
                        "cached": outcome.cached,
                        "stale": outcome.stale,
                        "provider": outcome.provider,
                    }),
                );
            });
        }
        IpQueryInput::UpdateProxy {
            request_id,
            proxy,
            revision,
        } => {
            let mut state_lock = state.lock().await;
            state_lock.proxy = proxy.clone();
            state_lock.proxy_revision = revision.unwrap_or(state_lock.proxy_revision + 1);
            let revision = state_lock.proxy_revision;
            drop(state_lock);
            acknowledge(
                request_id.as_ref(),
                json!({ "revision": revision, "applied": true }),
            );
        }
        IpQueryInput::UpdateKeys {
            request_id,
            keys,
            revision,
        } => {
            let mut state_lock = state.lock().await;
            // 合并密钥（空值删除）
            for (name, key) in &keys {
                if key.is_empty() {
                    state_lock.keys.remove(name);
                } else {
                    state_lock.keys.insert(name.clone(), key.clone());
                }
            }
            state_lock.keys_revision = revision.unwrap_or(state_lock.keys_revision + 1);
            let revision = state_lock.keys_revision;
            let enabled = state_lock.keys.len();
            drop(state_lock);
            // 不记录密钥内容与含密钥 URL
            acknowledge(
                request_id.as_ref(),
                json!({ "revision": revision, "keyedProviders": enabled }),
            );
        }
        IpQueryInput::Cancel {
            request_id,
            query_id,
        } => {
            let mut state_lock = state.lock().await;
            let cancelled = match query_id {
                Some(query_id) => state_lock
                    .queries
                    .remove(&query_id)
                    .map(|token| token.cancel())
                    .is_some(),
                None => {
                    // 无目标：取消全部在途查询（幂等）
                    for (_, token) in state_lock.queries.drain() {
                        token.cancel();
                    }
                    true
                }
            };
            drop(state_lock);
            acknowledge(request_id.as_ref(), json!({ "cancelled": cancelled }));
        }
        IpQueryInput::Close { request_id } => {
            acknowledge(request_id.as_ref(), json!({}));
        }
    }
}

pub async fn serve() -> Result<(), String> {
    emit(&json!({
        "type": "ready",
        "schemaVersion": IP_QUERY_SCHEMA_VERSION,
        "capabilities": ["query", "proxy-update", "key-update", "cancel"],
        "cacheTtlMs": cache_ttl_ms(),
        "cacheMax": cache_max(),
    }));

    let state = std::sync::Arc::new(tokio::sync::Mutex::new(QueryState {
        cache: LruCache::new(cache_max()),
        proxy: None,
        proxy_revision: 0,
        keys: HashMap::new(),
        keys_revision: 0,
        queries: HashMap::new(),
        refreshing: std::collections::HashSet::new(),
    }));

    let stdin = tokio::io::stdin();
    let mut lines = BufReader::new(stdin).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        if line.trim().is_empty() {
            continue;
        }
        let input: IpQueryInput = match serde_json::from_str(&line) {
            Ok(input) => input,
            Err(error) => {
                emit_event(
                    "error",
                    json!({
                        "errorCode": "IP_QUERY_INVALID_REQUEST",
                        "errorKind": "validation",
                        "retryable": false,
                        "error": error.to_string(),
                    }),
                );
                continue;
            }
        };
        handle_input(&state, input).await;
    }
    Ok(())
}
