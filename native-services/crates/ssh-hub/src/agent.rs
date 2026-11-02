//! Connections to the local SSH agent: a Unix socket, a Windows named pipe,
//! or Pageant.

use tokio::io::{AsyncRead, AsyncWrite};

pub(crate) trait AgentIo: AsyncRead + AsyncWrite + Send + Unpin {}
impl<T: AsyncRead + AsyncWrite + Send + Unpin> AgentIo for T {}

/// Raw byte stream to the agent, used to bridge forwarded agent channels.
pub(crate) async fn open_stream(path: &str) -> std::io::Result<Box<dyn AgentIo>> {
    #[cfg(windows)]
    {
        if path.eq_ignore_ascii_case("pageant") {
            let stream = pageant::PageantStream::new()
                .await
                .map_err(|error| std::io::Error::other(error.to_string()))?;
            return Ok(Box::new(stream));
        }
        let pipe = tokio::net::windows::named_pipe::ClientOptions::new().open(path)?;
        Ok(Box::new(pipe))
    }
    #[cfg(unix)]
    {
        Ok(Box::new(tokio::net::UnixStream::connect(path).await?))
    }
}
