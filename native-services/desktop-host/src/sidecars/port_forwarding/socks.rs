use std::io;
use std::net::{Ipv4Addr, Ipv6Addr};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

fn invalid() -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, "SOCKS_PROTOCOL")
}

pub(super) async fn reply(socket: &mut TcpStream, code: u8) -> io::Result<()> {
    socket.write_all(&[5, code, 0, 1, 0, 0, 0, 0, 0, 0]).await
}

pub(super) async fn request(socket: &mut TcpStream) -> io::Result<(String, u16)> {
    let mut greeting = [0; 2];
    socket.read_exact(&mut greeting).await?;
    if greeting[0] != 5 || greeting[1] == 0 {
        return Err(invalid());
    }
    let mut methods = vec![0; usize::from(greeting[1])];
    socket.read_exact(&mut methods).await?;
    if !methods.contains(&0) {
        socket.write_all(&[5, 255]).await?;
        return Err(invalid());
    }
    socket.write_all(&[5, 0]).await?;
    let mut header = [0; 4];
    socket.read_exact(&mut header).await?;
    if header[0] != 5 || header[2] != 0 {
        reply(socket, 1).await?;
        return Err(invalid());
    }
    if header[1] != 1 {
        reply(socket, 7).await?;
        return Err(invalid());
    }
    let host = match header[3] {
        1 => {
            let mut bytes = [0; 4];
            socket.read_exact(&mut bytes).await?;
            Ipv4Addr::from(bytes).to_string()
        }
        3 => {
            let length = socket.read_u8().await?;
            if length == 0 {
                reply(socket, 8).await?;
                return Err(invalid());
            }
            let mut bytes = vec![0; usize::from(length)];
            socket.read_exact(&mut bytes).await?;
            String::from_utf8(bytes).map_err(|_| invalid())?
        }
        4 => {
            let mut bytes = [0; 16];
            socket.read_exact(&mut bytes).await?;
            Ipv6Addr::from(bytes).to_string()
        }
        _ => {
            reply(socket, 8).await?;
            return Err(invalid());
        }
    };
    let port = socket.read_u16().await?;
    if port == 0 || host.contains('\0') {
        reply(socket, 1).await?;
        return Err(invalid());
    }
    // Exact reads leave coalesced application bytes in the socket for the relay.
    Ok((host, port))
}
