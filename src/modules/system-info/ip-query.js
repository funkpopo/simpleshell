const https = require("https");

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
  amap: {
    name: "amap.com",
    buildUrl: (ip, key) => `https://restapi.amap.com/v3/ip?key=${key}&ip=${ip}`,
    transform: (data, ip) => {
      if (data.status !== "1") {
        throw new Error(`Amap API error: ${data.info}`);
      }
      return {
        ret: "ok",
        data: {
          ip: ip,
          location: [data.province, data.city].filter(Boolean),
          latitude: undefined,
          longitude: undefined,
        },
      };
    },
    key: process.env.AMAP_KEY,
  },
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

async function geocodeWithAmap(address, key, logger) {
  if (!key) return null;
  const url = `https://restapi.amap.com/v3/geocode/geo?key=${key}&address=${encodeURIComponent(address)}`;
  try {
    const data = await new Promise((resolve, reject) => {
      const req = https.get(url, (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve(JSON.parse(body)));
      });
      req.on("error", (e) => reject(e));
    });

    if (data.status === "1" && data.geocodes && data.geocodes.length > 0) {
      const [longitude, latitude] = data.geocodes[0].location.split(",");
      return {
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude),
      };
    }
  } catch (error) {
    logger(`Amap geocoding error: ${error.message}`, "ERROR");
  }
  return null;
}

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

function fetchIpInfo(provider, ip, logger) {
  const url = provider.key
    ? provider.buildUrl(ip, provider.key)
    : provider.buildUrl(ip);

  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const requestModule =
      parsedUrl.protocol === "https:" ? https : require("http");
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: "GET",
      headers: { "User-Agent": "SimpleShell-App" },
      timeout: 5000,
    };

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

async function queryIpAddress(ip = "", logger = console.log) {
  try {
    const allProviders = [...DEFAULT_API_PROVIDERS];
    // Dynamically add key-based providers if their keys are present
    for (const key in KEY_API_PROVIDERS) {
      if (KEY_API_PROVIDERS[key].key) {
        logger(
          `${KEY_API_PROVIDERS[key].name} API Key已配置，启用该服务。`,
          "INFO",
        );
        allProviders.unshift(KEY_API_PROVIDERS[key]);
      }
    }

    if (ip) {
      logger(`查询IP地址: ${ip}`, "INFO");
      const lookupProviders = allProviders.filter((p) => !p.ownIpOnly);
      const promises = lookupProviders.map((provider) =>
        fetchIpInfo(provider, ip, logger),
      );
      return await Promise.any(promises);
    } else {
      logger("查询本机IP...", "INFO");

      const providers = {
        chinese: allProviders.find((p) => p.name === "myip.ipip.net"),
        geo: allProviders.find((p) => p.name === "geolocation-db.com (own)"),
      };

      const chinesePromise = providers.chinese
        ? fetchIpInfo(providers.chinese, "", logger)
        : Promise.reject(new Error("Chinese provider not configured"));
      const geoPromise = providers.geo
        ? fetchIpInfo(providers.geo, "", logger)
        : Promise.reject(new Error("Geo provider not configured"));

      const results = await Promise.allSettled([chinesePromise, geoPromise]);
      const chineseResult =
        results[0].status === "fulfilled" ? results[0].value : null;
      const geoResult =
        results[1].status === "fulfilled" ? results[1].value : null;

      if (chineseResult || geoResult) {
        const finalData = {
          ...geoResult?.data,
          ...chineseResult?.data,
        };

        if (
          (!finalData.latitude || !finalData.longitude) &&
          finalData.location &&
          finalData.location.length > 0
        ) {
          const address = finalData.location.slice(0, 3).join("");
          logger(`尝试通过地址进行地理编码: ${address}`, "INFO");
          const geoCoords = await geocodeWithAmap(
            address,
            KEY_API_PROVIDERS.amap.key,
            logger,
          );
          if (geoCoords) {
            finalData.latitude = geoCoords.latitude;
            finalData.longitude = geoCoords.longitude;
            logger(
              `地理编码成功: ${geoCoords.latitude}, ${geoCoords.longitude}`,
              "INFO",
            );
          }
        }

        return { ret: "ok", data: finalData };
      }

      // Fallback if primary providers fail or don't exist
      logger("主查询服务失败或未配置，启用备用服务...", "INFO");
      const standardLookupPromise = (async () => {
        const publicIp = await getPublicIp();
        const lookupProviders = allProviders.filter((p) => !p.ownIpOnly);
        const standardPromises = lookupProviders.map((provider) =>
          fetchIpInfo(provider, publicIp, logger),
        );
        return Promise.any(standardPromises);
      })();
      return await standardLookupPromise;
    }
  } catch (error) {
    if (typeof logger === "function") {
      const errorMessages = error.errors
        ? error.errors.map((e) => e.message).join(", ")
        : error.message || "Unknown error";
      logger(`所有IP地址查询服务失败: ${errorMessages}`, "ERROR");
    }
    return {
      ret: "failed",
      msg: "所有IP地址查询服务均失败或超时。",
    };
  }
}

module.exports = {
  queryIpAddress,
};
