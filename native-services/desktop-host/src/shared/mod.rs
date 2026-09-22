//! 最小共享实现：由宿主声明模块，sidecar 按需复用。
//! 不预先建设通用框架；禁止跨 sidecar 互相导入，共享代码只能放在这里。

pub mod network;
