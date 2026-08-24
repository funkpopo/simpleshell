const https = require("https");
const http = require("http");
const { SocksProxyAgent } = require("socks-proxy-agent");
const { HttpsProxyAgent } = require("https-proxy-agent");
const { HttpProxyAgent } = require("http-proxy-agent");
const ipUtils = require("../../utils/ip");
const { t: translateLocale, getUiLanguage } = require("../../shared/mainI18n");
const configService = require("../../services/configService");
const ipQueryText = (key, params = {}) =>
  translateLocale(key, { lng: getUiLanguage(configService), ...params });

// In-memory LRU + TTL cache (skeleton)
const CACHE_TTL_MS = parseInt(process.env.IPQUERY_CACHE_TTL_MS || "300000", 10); // 5 min default
const CACHE_MAX = parseInt(process.env.IPQUERY_CACHE_MAX || "200", 10);
const SWR_ENABLED = true; // stale-while-revalidate
const cache = new Map(); // key -> { ts, result }

function cacheKey(ip) {
  return ip && ip.trim() ? ip.trim() : "__MY_IP__";
}

function getFromCache(ip) {
  const key = cacheKey(ip);
  const entry = cache.get(key);
  if (!entry) return null;
  // move to recent
  cache.delete(key);
  cache.set(key, entry);
  return entry;
}

function setToCache(ip, result) {
  const key = cacheKey(ip);
  const entry = { ts: Date.now(), result };
  if (cache.has(key)) cache.delete(key);
  cache.set(key, entry);
  // evict LRU
  while (cache.size > CACHE_MAX) {
    const oldestKey = cache.keys().next().value;
    cache.delete(oldestKey);
  }
}

const transformGeolocationDB = (data, ip) => {
  if (!data.IPv4) {
    throw new Error(`geolocation-db.com invalid response`);
  }
  return {
    ret: "ok",
    data: {
      ip: data.IPv4 || ip,
      location: [data.country_name, data.state, data.city].filter(Boolean),
      latitude: data.latitude,
      longitude: data.longitude,
    },
  };
};

// 默认API提供商
const DEFAULT_API_PROVIDERS = [
  {
    name: "myip.ipip.net",
    buildUrl: () => `https://myip.ipip.net/json`,
    transform: (data) => {
      if (data.ret !== "ok") {
        throw new Error(`myip.ipip.net API error`);
      }
      return {
        ret: "ok",
        data: {
          ip: data.data.ip,
          location: data.data.location.filter(Boolean),
        },
      };
    },
    ownIpOnly: true,
  },
  {
    name: "geolocation-db.com (own)",
    buildUrl: () => `https://geolocation-db.com/json/`,
    transform: transformGeolocationDB,
    ownIpOnly: true,
  },
  {
    name: "ipwho.is (own)",
    buildUrl: () => `https://ipwho.is/`,
    transform: (data, ip) => {
      if (data.success === false) {
        throw new Error(`ipwho.is API error: ${data.message}`);
      }
      return {
        ret: "ok",
        data: {
          ip: data.ip || ip,
          location: [
            data.country,
            data.region,
            data.city,
            data.org || data.isp,
          ].filter(Boolean),
          latitude: data.latitude,
          longitude: data.longitude,
        },
      };
    },
    ownIpOnly: true,
  },
  {
    name: "ipinfo.io (own)",
    buildUrl: () => `https://ipinfo.io/json`,
    transform: (data, ip) => {
      if (data.error) {
        throw new Error(`ipinfo.io API error: ${data.error.title}`);
      }
      const locParts = String(data.loc || "")
        .split(",")
        .map(Number);
      return {
        ret: "ok",
        data: {
          ip: data.ip || ip,
          location: [
            data.country,
            data.region,
            data.city,
            data.org || data.isp,
          ].filter(Boolean),
          latitude: locParts[0],
          longitude: locParts[1],
        },
      };
    },
    ownIpOnly: true,
  },
  {
    name: "ipapi.co (own)",
    buildUrl: () => `https://ipapi.co/json/`,
    transform: (data, ip) => {
      if (data.error) {
        throw new Error(`ipapi.co API error: ${JSON.stringify(data.reason || data.error)}`);
      }
      return {
        ret: "ok",
        data: {
          ip: data.ip || ip,
          location: [
            data.country_name,
            data.region,
            data.city,
            data.org,
          ].filter(Boolean),
          latitude: data.latitude,
          longitude: data.longitude,
        },
      };
    },
    ownIpOnly: true,
  },
  {
    name: "api.vore.top (own)",
    buildUrl: () => `https://api.vore.top/api/IPdata`,
    transform: (data, ip) => {
      if (data.code !== 200) {
        throw new Error(`api.vore.top API error: ${data.msg}`);
      }
      const info = data.data?.ipInfo || {};
      const latlng = Array.isArray(info.latlng)
        ? info.latlng.map(Number)
        : [];
      return {
        ret: "ok",
        data: {
          ip: data.data?.ip || ip,
          location: [
            info.country,
            info.province,
            info.city,
            info.isp,
          ].filter(Boolean),
          latitude: latlng[0],
          longitude: latlng[1],
        },
      };
    },
    ownIpOnly: true,
  },
  {
    name: "whois.pconline.com.cn (own)",
    buildUrl: () => `https://whois.pconline.com.cn/ipJson.jsp?json=true`,
    transform: (data, ip) => {
      if (data.err) {
        throw new Error(`pconline API error: ${data.err}`);
      }
      return {
        ret: "ok",
        data: {
          ip: data.ip || ip,
          location: [data.pro, data.city, data.addr].filter(Boolean),
        },
      };
    },
    ownIpOnly: true,
  },
  {
    name: "whois.pconline.com.cn (own)",
    buildUrl: () => `https://whois.pconline.com.cn/ipJson.jsp?json=true`,
    transform: (data, ip) => {
      if (data.err) {
        throw new Error(`pconline API error: ${data.err}`);
      }
      return {
        ret: "ok",
        data: {
          ip: data.ip || ip,
          location: [data.pro, data.city, data.addr].filter(Boolean),
        },
      };
    },
    ownIpOnly: true,
  },
  {
    name: "ip.useragentinfo.com (own)",
    buildUrl: () => `https://ip.useragentinfo.com/json`,
    transform: (data, ip) => ({
      ret: "ok",
      data: {
        ip: data.ip || ip,
        location: [
          data.country,
          data.province,
          data.city,
          data.isp,
        ].filter(Boolean),
      },
    }),
    ownIpOnly: true,
  },
  {
    name: "geolocation-db.com (lookup)",
    buildUrl: (ip) => `https://geolocation-db.com/json/${ip}`,
    transform: transformGeolocationDB,
  },
  {
    name: "ip-api.com",
    buildUrl: (ip) => `https://ip-api.com/json/${ip}`,
    transform: (data, ip) => ({
      ret: "ok",
      data: {
        ip: data.query || ip,
        location: [
          data.country,
          data.regionName,
          data.city,
          data.isp || data.org,
        ].filter(Boolean),
        latitude: data.lat,
        longitude: data.lon,
      },
    }),
  },
  {
    name: "ipwho.is (lookup)",
    buildUrl: (ip) => `https://ipwho.is/${ip}`,
    transform: (data, ip) => {
      if (data.success === false) {
        throw new Error(`ipwho.is API error: ${data.message}`);
      }
      return {
        ret: "ok",
        data: {
          ip: data.ip || ip,
          location: [
            data.country,
            data.region,
            data.city,
            data.org || data.isp,
          ].filter(Boolean),
          latitude: data.latitude,
          longitude: data.longitude,
        },
      };
    },
  },
  {
    name: "ipinfo.io (lookup)",
    buildUrl: (ip) => `https://ipinfo.io/${ip}/json`,
    transform: (data, ip) => {
      if (data.error) {
        throw new Error(`ipinfo.io API error: ${data.error.title}`);
      }
      const locParts = String(data.loc || "")
        .split(",")
        .map(Number);
      return {
        ret: "ok",
        data: {
          ip: data.ip || ip,
          location: [
            data.country,
            data.region,
            data.city,
            data.org || data.isp,
          ].filter(Boolean),
          latitude: locParts[0],
          longitude: locParts[1],
        },
      };
    },
  },
  {
    name: "ipapi.co (lookup)",
    buildUrl: (ip) => `https://ipapi.co/${ip}/json/`,
    transform: (data, ip) => {
      if (data.error) {
        throw new Error(`ipapi.co API error: ${JSON.stringify(data.reason || data.error)}`);
      }
      return {
        ret: "ok",
        data: {
          ip: data.ip || ip,
          location: [
            data.country_name,
            data.region,
            data.city,
            data.org,
          ].filter(Boolean),
          latitude: data.latitude,
          longitude: data.longitude,
        },
      };
    },
  },
  {
    name: "api.vore.top (lookup)",
    buildUrl: (ip) => `https://api.vore.top/api/IPdata?ip=${ip}`,
    transform: (data, targetIp) => {
      if (data.code !== 200) {
        throw new Error(`api.vore.top API error: ${data.msg}`);
      }
      const info = data.data?.ipInfo || {};
      const latlng = Array.isArray(info.latlng)
        ? info.latlng.map(Number)
        : [];
      return {
        ret: "ok",
        data: {
          ip: data.data?.ip || targetIp,
          location: [
            info.country,
            info.province,
            info.city,
            info.isp,
          ].filter(Boolean),
          latitude: latlng[0],
          longitude: latlng[1],
        },
      };
    },
  },
  {
    name: "freegeoip.live",
    buildUrl: (ip) => `https://freegeoip.live/json/${ip}`,
    transform: (data, ip) => ({
      ret: "ok",
      data: {
        ip: data.ip || ip,
        location: [
          data.country_name,
          data.region_name,
          data.city,
          data.isp || data.organization_name,
        ].filter(Boolean),
        latitude: data.latitude,
        longitude: data.longitude,
      },
    }),
  },
  {
    name: "ip.sb",
    buildUrl: (ip) => `https://api.ip.sb/geoip/${ip}`,
    transform: (data, ip) => ({
      ret: "ok",
      data: {
        ip: data.ip || ip,
        location: [
          data.country,
          data.region,
          data.city,
          data.organization,
        ].filter(Boolean),
        latitude: data.latitude,
        longitude: data.longitude,
      },
    }),
  },
  {
    name: "yaohud.cn",
    buildUrl: (ip) => `https://api.yaohud.cn/api/v5/geoip?ip=${ip}`,
    transform: (data, ip) => {
      if (data.code !== 200) {
        throw new Error(`Yaohud API error: ${data.msg}`);
      }
      return {
        ret: "ok",
        data: {
          ip: data.data.IP || ip,
          location: [
            data.data.nation,
            data.data.Country,
            data.data.Local,
          ].filter(Boolean),
          latitude: parseFloat(data.data.lat),
          longitude: parseFloat(data.data.lng),
        },
      };
    },
  },
];

// 需要Key的API提供商
const KEY_API_PROVIDERS = {
  ip2location: {
    name: "ip2location.io",
    buildUrl: (ip, key) => `https://api.ip2location.io/?key=${key}&ip=${ip}`,
    transform: (data, ip) => {
      if (data.error) {
        throw new Error(
          `ip2location.io API error: ${data.error.error_message}`,
        );
      }
      return {
        ret: "ok",
        data: {
          ip: data.ip || ip,
          location: [
            data.country_name,
            data.region_name,
            data.city_name,
            data.as, // 'as' field often contains ISP/Org info
          ].filter(Boolean),
          latitude: data.latitude,
          longitude: data.longitude,
        },
      };
    },
    key: process.env.IP2LOCATION_KEY,
  },
};

async function getPublicIp(proxyConfig = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "api.ip.sb",
      path: "/ip",
      method: "GET",
      headers: { "User-Agent": "SimpleShell-App" },
    };

    // 添加代理支持
    if (proxyConfig && proxyConfig.host && proxyConfig.port) {
      try {
        if (proxyConfig.type === "socks4" || proxyConfig.type === "socks5") {
          // SOCKS代理
          const socksUrl = `${proxyConfig.type}://${proxyConfig.username ? `${proxyConfig.username}:${proxyConfig.password}@` : ""}${proxyConfig.host}:${proxyConfig.port}`;
          options.agent = new SocksProxyAgent(socksUrl);
        } else {
          // HTTP/HTTPS代理
          const proxyUrl = `http://${proxyConfig.username ? `${proxyConfig.username}:${proxyConfig.password}@` : ""}${proxyConfig.host}:${proxyConfig.port}`;
          options.agent = new HttpsProxyAgent(proxyUrl);
        }
      } catch (proxyError) {
        reject(new Error(ipQueryText("mainProcess.ipQuery.proxyConfigError", { error: proxyError.message })));
        return;
      }
    }

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode === 200) {
          resolve(data.trim());
        } else {
          reject(
            new Error(`Failed to get public IP, status: ${res.statusCode}`),
          );
        }
      });
    });
    req.on("error", (e) =>
      reject(new Error(`getPublicIp request error: ${e.message}`)),
    );
    req.end();
  });
}

function fetchIpInfo(provider, ip, logger, proxyConfig = null) {
  const url = provider.key
    ? provider.buildUrl(ip, provider.key)
    : provider.buildUrl(ip);

  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const requestModule = parsedUrl.protocol === "https:" ? https : http;
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: "GET",
      headers: { "User-Agent": "SimpleShell-App" },
      timeout: 5000,
    };

    // 添加代理支持
    if (proxyConfig && proxyConfig.host && proxyConfig.port) {
      try {
        if (proxyConfig.type === "socks4" || proxyConfig.type === "socks5") {
          // SOCKS代理
          const socksUrl = `${proxyConfig.type}://${proxyConfig.username ? `${proxyConfig.username}:${proxyConfig.password}@` : ""}${proxyConfig.host}:${proxyConfig.port}`;
          options.agent = new SocksProxyAgent(socksUrl);
        } else {
          // HTTP/HTTPS代理
          const proxyUrl = `http://${proxyConfig.username ? `${proxyConfig.username}:${proxyConfig.password}@` : ""}${proxyConfig.host}:${proxyConfig.port}`;
          if (parsedUrl.protocol === "https:") {
            options.agent = new HttpsProxyAgent(proxyUrl);
          } else {
            options.agent = new HttpProxyAgent(proxyUrl);
          }
        }
      } catch (proxyError) {
        reject(new Error(ipQueryText("mainProcess.ipQuery.proxyConfigError", { error: proxyError.message })));
        return;
      }
    }

    const req = requestModule.request(options, (res) => {
      if (res.statusCode !== 200) {
        return reject(
          new Error(`API ${provider.name} HTTP Error: ${res.statusCode}`),
        );
      }
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const jsonData = JSON.parse(data);
          resolve(provider.transform(jsonData, ip));
        } catch (error) {
          reject(
            new Error(`API ${provider.name} parsing error: ${error.message}`),
          );
        }
      });
    });

    req.on("error", (error) =>
      reject(new Error(`API ${provider.name} request error: ${error.message}`)),
    );
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`API ${provider.name} request timed out`));
    });
    req.end();
  });
}

async function queryIpAddress(ip = "", logger = null, proxyConfig = null) {
  try {
    // Input validation and private/special detection when an IP is provided
    if (ip && ip.trim()) {
      const ver = ipUtils.isIP(ip.trim());
      if (ver === 0) {
        return { ret: "failed", msg: ipQueryText("mainProcess.ipQuery.invalidIp") };
      }
      if (ipUtils.isPrivateOrSpecial(ip.trim())) {
        return { ret: "failed", msg: ipQueryText("mainProcess.ipQuery.privateOrReserved") };
      }
    }

    // Cache lookup
    const entry = getFromCache(ip);
    const now = Date.now();
    if (entry && now - entry.ts < CACHE_TTL_MS) {
      if (typeof logger === "function") {
        logger(`IP query cache hit: ${cacheKey(ip)}`, "INFO");
      }
      return entry.result;
    }

    const shouldServeStale =
      !!entry && now - entry.ts >= CACHE_TTL_MS && SWR_ENABLED;

    const allProviders = [...DEFAULT_API_PROVIDERS];
    // Dynamically add key-based providers if their keys are present
    for (const key in KEY_API_PROVIDERS) {
      if (KEY_API_PROVIDERS[key].key) {
        logger(
          `${KEY_API_PROVIDERS[key].name} API key configured; enabling provider.`,
          "INFO",
        );
        allProviders.unshift(KEY_API_PROVIDERS[key]);
      }
    }

    // 记录代理配置使用情况
    if (proxyConfig && proxyConfig.host && proxyConfig.port) {
      logger(
        `Using proxy for IP query: ${proxyConfig.type} ${proxyConfig.host}:${proxyConfig.port}`,
        "INFO",
      );
    }

    if (ip) {
      logger(`Querying IP address: ${ip}`, "INFO");
      const doNetwork = async () => {
        const lookupProviders = allProviders.filter((p) => !p.ownIpOnly);
        const promises = lookupProviders.map((provider) =>
          fetchIpInfo(provider, ip, logger, proxyConfig),
        );
        const res = await Promise.any(promises);
        // Cache success
        if (res && res.ret === "ok") setToCache(ip, res);
        return res;
      };

      if (shouldServeStale) {
        // background refresh
        doNetwork().catch(() => {});
        return entry.result;
      }
      return await doNetwork();
    } else {
      logger("Querying own IP...", "INFO");

      const ownProviders = allProviders.filter((p) => p.ownIpOnly);

      const doNetwork = async () => {
        try {
          // Race all own-IP single-shot providers; return the first success.
          // This resolves as soon as the fastest provider responds instead of
          // waiting for the slowest one, greatly reducing sidebar latency.
          const promises = ownProviders.map((provider) =>
            fetchIpInfo(provider, "", logger, proxyConfig),
          );
          const res = await Promise.any(promises);
          if (res && res.ret === "ok") setToCache("", res);
          return res;
        } catch {
          // Fallback if all own-IP providers fail/missing:
          // get the public IP first, then look it up against the remaining providers.
          logger("Own providers failed or missing; using lookup fallback...", "INFO");
          const publicIp = await getPublicIp(proxyConfig);
          const lookupProviders = allProviders.filter((p) => !p.ownIpOnly);
          const standardPromises = lookupProviders.map((provider) =>
            fetchIpInfo(provider, publicIp, logger, proxyConfig),
          );
          const res = await Promise.any(standardPromises);
          if (res && res.ret === "ok") setToCache("", res);
          return res;
        }
      };

      if (shouldServeStale) {
        // background refresh; serve stale meanwhile
        doNetwork().catch(() => {});
        return entry.result;
      }
      return await doNetwork();
    }
  } catch (error) {
    if (typeof logger === "function") {
      const errorMessages = error.errors
        ? error.errors.map((e) => e.message).join(", ")
        : error.message || "Unknown error";
      logger(`All IP query providers failed: ${errorMessages}`, "ERROR");
    }
    return {
      ret: "failed",
      msg: ipQueryText("mainProcess.ipQuery.allProvidersFailed"),
    };
  }
}

module.exports = {
  queryIpAddress,
};
