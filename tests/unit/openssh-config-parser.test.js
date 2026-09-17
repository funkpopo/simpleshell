import { describe, it, expect } from "vitest";
import {
  hostMatchesPattern,
  hostMatchesBlock,
  parseOpenSSHConfig,
  mapHostsToConnections,
  expandPathTokens,
} from "../../src/core/connection/openssh-config-parser";

describe("hostMatchesPattern", () => {
  it("精确匹配（大小写不敏感）", () => {
    expect(hostMatchesPattern("web1", "web1")).toBe(true);
    expect(hostMatchesPattern("Web1", "web1")).toBe(true);
    expect(hostMatchesPattern("web1", "web2")).toBe(false);
  });

  it("支持 * 与 ? 通配", () => {
    expect(hostMatchesPattern("*.example.com", "api.example.com")).toBe(true);
    expect(hostMatchesPattern("*.example.com", "a.b.example.com")).toBe(true);
    expect(hostMatchesPattern("web?", "web1")).toBe(true);
    expect(hostMatchesPattern("web?", "web12")).toBe(false);
  });

  it("正则特殊字符不破坏匹配", () => {
    expect(hostMatchesPattern("host(1)", "host(1)")).toBe(true);
    expect(hostMatchesPattern("host.1", "hostx1")).toBe(false);
  });
});

describe("hostMatchesBlock", () => {
  it("多模式任一命中即匹配", () => {
    expect(hostMatchesBlock(["web*", "db1"], "db1")).toBe(true);
    expect(hostMatchesBlock(["web*", "db1"], "db2")).toBe(false);
  });

  it("取反模式命中则不匹配", () => {
    expect(hostMatchesBlock(["*", "!db*"], "db1")).toBe(false);
    expect(hostMatchesBlock(["*", "!db*"], "web1")).toBe(true);
  });
});

describe("parseOpenSSHConfig", () => {
  it("空内容返回空结果", () => {
    expect(parseOpenSSHConfig("")).toEqual({ hosts: [], warnings: [] });
    expect(parseOpenSSHConfig(null)).toEqual({ hosts: [], warnings: [] });
  });

  it("解析基础字段（HostName/Port/User）", () => {
    const { hosts, warnings } = parseOpenSSHConfig(
      [
        "Host web1",
        "  HostName 192.168.1.10",
        "  Port 2222",
        "  User alice",
      ].join("\n"),
    );
    expect(warnings).toHaveLength(0);
    expect(hosts).toHaveLength(1);
    expect(hosts[0]).toMatchObject({
      alias: "web1",
      host: "192.168.1.10",
      port: 2222,
      username: "alice",
      authType: "password",
    });
  });

  it("支持 Key=Value 写法与注释", () => {
    const { hosts } = parseOpenSSHConfig(
      ["# 注释行", "Host=web1", "HostName=example.com # 行内注释", "Port=2200"].join(
        "\n",
      ),
    );
    expect(hosts[0].host).toBe("example.com");
    expect(hosts[0].port).toBe(2200);
  });

  it("引号包裹的参数被还原为单个值", () => {
    const { hosts } = parseOpenSSHConfig(
      ['Host web1', 'HostName "my server.example.com"'].join("\n"),
    );
    expect(hosts[0].host).toBe("my server.example.com");
  });

  it("IdentityFile 展开 ~ 并推断 privateKey 认证", () => {
    const { hosts } = parseOpenSSHConfig(
      ["Host web1", "IdentityFile ~/.ssh/id_ed25519", "Port 22"].join("\n"),
      { homeDir: "/home/alice" },
    );
    expect(hosts[0].privateKeyPath).toBe("/home/alice/.ssh/id_ed25519");
    expect(hosts[0].authType).toBe("privateKey");
  });

  it("展开 %d / %h / %% token", () => {
    expect(expandPathTokens("%d/.ssh/key", "/home/a", "h1")).toBe(
      "/home/a/.ssh/key",
    );
    expect(expandPathTokens("/keys/%h", "/home/a", "h1")).toBe("/keys/h1");
    expect(expandPathTokens("50%%.conf", "/home/a", "h1")).toBe("50%.conf");
  });

  it("first-obtained-wins：后续块不覆盖已有值", () => {
    const { hosts } = parseOpenSSHConfig(
      [
        "Host web1",
        "  Port 2222",
        "",
        "Host *",
        "  Port 9999",
        "  User bob",
      ].join("\n"),
    );
    expect(hosts[0].port).toBe(2222);
    expect(hosts[0].username).toBe("bob");
  });

  it("通配模式不生成主机条目并记录 warning", () => {
    const { hosts, warnings } = parseOpenSSHConfig("Host *.corp.local\n  User dev");
    expect(hosts).toHaveLength(0);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("多模式 Host 行拆分为多个条目", () => {
    const { hosts } = parseOpenSSHConfig(
      ["Host web1 web2", "  Port 22", "  User shared"].join("\n"),
    );
    expect(hosts.map((h) => h.alias)).toEqual(["web1", "web2"]);
    expect(hosts[0].username).toBe("shared");
    expect(hosts[1].host).toBe("web2");
  });

  it("取反模式不生成条目", () => {
    const { hosts } = parseOpenSSHConfig(
      "Host web* !web3\n  Port 22",
    );
    // 通配模式与取反模式均不生成具体条目
    expect(hosts).toHaveLength(0);
  });

  it("全局默认（首个 Host 前的顶层选项）生效", () => {
    const { hosts } = parseOpenSSHConfig(
      ["User globaluser", "Port 2200", "", "Host web1", "HostName h1"].join(
        "\n",
      ),
    );
    expect(hosts[0]).toMatchObject({
      alias: "web1",
      host: "h1",
      port: 2200,
      username: "globaluser",
    });
  });

  it("Match 块被跳过且不污染 host 块", () => {
    const { hosts, warnings } = parseOpenSSHConfig(
      [
        "Host web1",
        "  Port 22",
        "",
        "Match host web2 user root",
        "  Port 9999",
        "  User root",
      ].join("\n"),
    );
    expect(hosts).toHaveLength(1);
    expect(hosts[0].alias).toBe("web1");
    expect(hosts[0].port).toBe(22);
    expect(warnings.some((w) => w.includes("Match"))).toBe(true);
  });

  it("捕获 ProxyJump/ProxyCommand 并记录到条目", () => {
    const { hosts } = parseOpenSSHConfig(
      [
        "Host bastion",
        "  HostName 10.0.0.1",
        "",
        "Host target",
        "  HostName 10.0.0.2",
        "  ProxyJump bastion",
      ].join("\n"),
    );
    const target = hosts.find((h) => h.alias === "target");
    expect(target.proxyJump).toBe("bastion");
  });

  it("重复 IdentityFile 全部收集，首个作为默认私钥路径", () => {
    const { hosts } = parseOpenSSHConfig(
      [
        "Host web1",
        "  IdentityFile ~/.ssh/id_a",
        "  IdentityFile ~/.ssh/id_b",
      ].join("\n"),
      { homeDir: "/home/a" },
    );
    expect(hosts[0].privateKeyPath).toBe("/home/a/.ssh/id_a");
    expect(hosts[0].identityFiles).toEqual([
      "/home/a/.ssh/id_a",
      "/home/a/.ssh/id_b",
    ]);
  });

  it("ForwardAgent yes 映射为 agentForward", () => {
    const { hosts } = parseOpenSSHConfig(
      "Host web1\n  ForwardAgent yes",
    );
    expect(hosts[0].agentForward).toBe(true);
  });

  it("非法端口被忽略", () => {
    const { hosts } = parseOpenSSHConfig(
      "Host web1\n  Port abc\n  Port 70000",
    );
    expect(hosts[0].port).toBeNull();
  });

  it("同一别名只生成一个条目（后者被忽略）", () => {
    const { hosts } = parseOpenSSHConfig(
      ["Host web1", "  Port 22", "Host web1", "  Port 3333"].join("\n"),
    );
    expect(hosts).toHaveLength(1);
    expect(hosts[0].port).toBe(22);
  });
});

describe("mapHostsToConnections", () => {
  const generateId = (prefix) => `${prefix}_test_${Math.random()}`;

  it("映射为与连接模型一致的结构", () => {
    const { hosts } = parseOpenSSHConfig(
      [
        "Host web1",
        "  HostName 1.2.3.4",
        "  Port 2222",
        "  User root",
        "  IdentityFile ~/.ssh/id_a",
      ].join("\n"),
      { homeDir: "/home/u" },
    );
    const { connections, skipped } = mapHostsToConnections(hosts, {
      generateId,
    });
    expect(skipped).toHaveLength(0);
    expect(connections[0]).toMatchObject({
      type: "connection",
      name: "web1",
      host: "1.2.3.4",
      port: 2222,
      username: "root",
      authType: "privateKey",
      privateKeyPath: "/home/u/.ssh/id_a",
      protocol: "ssh",
      proxy: null,
    });
  });

  it("跳过跳板主机并记录原因", () => {
    const { hosts } = parseOpenSSHConfig(
      "Host target\n  HostName 10.0.0.2\n  ProxyCommand nc -X connect %h %p",
    );
    const { connections, skipped } = mapHostsToConnections(hosts, {
      generateId,
    });
    expect(connections).toHaveLength(0);
    expect(skipped).toEqual([{ alias: "target", reason: "proxy" }]);
  });

  it("按 existingNames 去重", () => {
    const { hosts } = parseOpenSSHConfig(
      ["Host web1", "  HostName 1.2.3.4", "Host web2", "  HostName 1.2.3.5"].join(
        "\n",
      ),
    );
    const { connections, skipped } = mapHostsToConnections(hosts, {
      generateId,
      existingNames: new Set(["web1"]),
    });
    expect(connections).toHaveLength(1);
    expect(connections[0].name).toBe("web2");
    expect(skipped).toEqual([{ alias: "web1", reason: "duplicate" }]);
  });

  it("缺省端口回退为 22", () => {
    const { hosts } = parseOpenSSHConfig("Host web1\n  HostName 1.2.3.4");
    const { connections } = mapHostsToConnections(hosts, { generateId });
    expect(connections[0].port).toBe(22);
  });
});
