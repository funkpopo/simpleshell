const https = require("https");

async function getPublicIp() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "api.ip.sb",
      path: "/ip",
      method: "GET",
      headers: { "User-Agent": "SimpleShell-App" },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode === 200) {
          resolve(data.trim());
        } else {
          reject(new Error(`Failed to get public IP, status: ${res.statusCode}`));
        }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

async function queryIpAddress(ip = "", logger = console.log) {
  try {
    let targetIp = ip;
    if (!targetIp) {
      if (typeof logger === "function") logger("查询本机IP...", "INFO");
      targetIp = await getPublicIp();
    }
    
    if (typeof logger === "function") {
      logger(`查询IP地址: ${targetIp}`, "INFO");
    }

    const apiUrl = `https://api.ip.sb/geoip/${targetIp}`;
    return await fetchIpInfo(apiUrl, targetIp, logger);

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

function fetchIpInfo(apiUrl, ip, logger = console.log) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(apiUrl);
    const requestModule = parsedUrl.protocol === "https:" ? https : require("http");

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
          if (data.includes("<html")) {
            reject(new Error("返回了HTML而不是预期的数据格式"));
            return;
          }

          const jsonData = JSON.parse(data);

          resolve({
            ret: "ok",
            data: {
              ip: jsonData.ip || ip,
              location: [
                jsonData.country || "",
                jsonData.region || "",
                jsonData.city || "",
                jsonData.organization || "",
              ].filter(Boolean),
              latitude: jsonData.latitude,
              longitude: jsonData.longitude,
            },
          });
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
