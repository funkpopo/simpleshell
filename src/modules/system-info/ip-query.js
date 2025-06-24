const https = require("https");
const http = require("http");

async function queryIpAddress(ip = "", logger = console.log) {
  try {
    // 记录查询请求
    if (typeof logger === "function") {
      logger(`查询IP地址: ${ip || "本机IP"}`, "INFO");
    }

    // 构造API URL
    let apiUrl;
    if (ip) {
      // 对于查询特定IP，使用IP.SB API
      apiUrl = `https://api.ip.sb/geoip/${ip}`;
    } else {
      // 对于查询本机IP，使用myip.ipip.net
      apiUrl = "https://myip.ipip.net/json";
    }

    // 获取IP信息
    return await fetchIpInfo(apiUrl, ip, logger);
  } catch (error) {
    if (typeof logger === "function") {
      logger(`IP地址查询失败: ${error.message}`, "ERROR");
    }
    return {
      ret: "failed",
      msg: error.message,
    };
  }
}

function fetchIpInfo(apiUrl, ip = "", logger = console.log) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(apiUrl);
    const requestModule = parsedUrl.protocol === "https:" ? https : http;

    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: "GET",
      headers: {
        "User-Agent": "SimpleShell-App",
      },
    };

    const req = requestModule.request(options, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP Error: ${res.statusCode}`));
        return;
      }

      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });

      res.on("end", () => {
        try {
          // 处理响应
          if (data.indexOf("<html") !== -1) {
            // HTML响应（可能是错误页面）
            reject(new Error("返回了HTML而不是预期的数据格式"));
            return;
          }

          // 解析JSON
          const jsonData = JSON.parse(data);

          // 根据不同API转换为统一格式
          if (ip) {
            // IP.SB API 返回格式转换
            resolve({
              ret: "ok",
              data: {
                ip: jsonData.ip || ip,
                location: [
                  jsonData.country || "",
                  jsonData.region || "",
                  jsonData.city || "",
                  jsonData.organization || "",
                ].filter((item) => item !== ""),
              },
            });
          } else {
            // 原API格式
            resolve(jsonData);
          }
        } catch (error) {
          if (typeof logger === "function") {
            logger(
              `解析IP信息失败: ${error.message}, 原始数据: ${data.substring(0, 200)}`,
              "ERROR",
            );
          }
          reject(new Error(`解析IP信息失败: ${error.message}`));
        }
      });
    });

    req.on("error", (error) => {
      reject(new Error(`请求IP信息失败: ${error.message}`));
    });

    // 超时处理
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error("请求超时"));
    });

    req.end();
  });
}

module.exports = {
  queryIpAddress,
};
