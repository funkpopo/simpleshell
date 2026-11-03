//! Telnet option negotiation (RFC 854/855) for a terminal client: accepts the
//! server's ECHO and SUPPRESS-GO-AHEAD, offers TERMINAL-TYPE (RFC 1091) and
//! window size (NAWS, RFC 1073) when asked, refuses everything else.

pub const IAC: u8 = 255;
const DONT: u8 = 254;
const DO: u8 = 253;
const WONT: u8 = 252;
const WILL: u8 = 251;
const SB: u8 = 250;
const SE: u8 = 240;

const ECHO: u8 = 1;
const SGA: u8 = 3;
const TTYPE: u8 = 24;
const NAWS: u8 = 31;
const TTYPE_IS: u8 = 0;
const TTYPE_SEND: u8 = 1;
/// Longest subnegotiation kept; longer ones are dropped.
const MAX_SUBNEGOTIATION: usize = 1024;

#[derive(Clone, Copy, PartialEq, Debug)]
enum State {
    Data,
    Iac,
    Verb(u8),
    Sub,
    SubIac,
}

/// What received bytes produced.
#[derive(Default, Debug, PartialEq)]
pub struct Received {
    /// Terminal data, with protocol removed.
    pub data: Vec<u8>,
    /// Negotiation replies to send back.
    pub reply: Vec<u8>,
}

pub struct Telnet {
    state: State,
    sub: Vec<u8>,
    term: String,
    size: (u16, u16),
    /// Options we agreed to perform (WILL) / asked the server for (DO).
    local: [bool; 256],
    remote: [bool; 256],
}

impl Telnet {
    pub fn new(term: String, cols: u16, rows: u16) -> Self {
        Self {
            state: State::Data,
            sub: Vec::new(),
            term,
            size: (cols, rows),
            local: [false; 256],
            remote: [false; 256],
        }
    }

    pub fn receive(&mut self, bytes: &[u8]) -> Received {
        let mut out = Received::default();
        for &byte in bytes {
            self.state = match (self.state, byte) {
                (State::Data, IAC) => State::Iac,
                (State::Data, byte) => {
                    out.data.push(byte);
                    State::Data
                }
                (State::Iac, IAC) => {
                    out.data.push(IAC);
                    State::Data
                }
                (State::Iac, verb @ (WILL | WONT | DO | DONT)) => State::Verb(verb),
                (State::Iac, SB) => {
                    self.sub.clear();
                    State::Sub
                }
                // NOP, GA, data mark and the other commands carry nothing.
                (State::Iac, _) => State::Data,
                (State::Verb(verb), option) => {
                    self.negotiate(verb, option, &mut out.reply);
                    State::Data
                }
                (State::Sub, IAC) => State::SubIac,
                (State::Sub, byte) => {
                    if self.sub.len() < MAX_SUBNEGOTIATION {
                        self.sub.push(byte);
                    }
                    State::Sub
                }
                (State::SubIac, SE) => {
                    self.subnegotiation(&mut out.reply);
                    State::Data
                }
                (State::SubIac, IAC) => {
                    if self.sub.len() < MAX_SUBNEGOTIATION {
                        self.sub.push(IAC);
                    }
                    State::Sub
                }
                (State::SubIac, _) => State::Sub,
            };
        }
        out
    }

    /// Agrees to supported options once (requests for a mode already in
    /// effect are not acknowledged, RFC 854) and refuses the rest.
    fn negotiate(&mut self, verb: u8, option: u8, reply: &mut Vec<u8>) {
        let index = option as usize;
        match verb {
            DO if matches!(option, TTYPE | NAWS) => {
                if !self.local[index] {
                    self.local[index] = true;
                    reply.extend_from_slice(&[IAC, WILL, option]);
                    if option == NAWS {
                        reply.extend(self.naws_bytes());
                    }
                }
            }
            DO => reply.extend_from_slice(&[IAC, WONT, option]),
            DONT if self.local[index] => {
                self.local[index] = false;
                reply.extend_from_slice(&[IAC, WONT, option]);
            }
            WILL if matches!(option, ECHO | SGA) => {
                if !self.remote[index] {
                    self.remote[index] = true;
                    reply.extend_from_slice(&[IAC, DO, option]);
                }
            }
            WILL => reply.extend_from_slice(&[IAC, DONT, option]),
            WONT if self.remote[index] => {
                self.remote[index] = false;
                reply.extend_from_slice(&[IAC, DONT, option]);
            }
            _ => {}
        }
    }

    fn subnegotiation(&mut self, reply: &mut Vec<u8>) {
        if self.sub.as_slice() == [TTYPE, TTYPE_SEND] && self.local[TTYPE as usize] {
            reply.extend_from_slice(&[IAC, SB, TTYPE, TTYPE_IS]);
            reply.extend(escape(self.term.as_bytes()));
            reply.extend_from_slice(&[IAC, SE]);
        }
    }

    fn naws_bytes(&self) -> Vec<u8> {
        let (cols, rows) = self.size;
        let mut bytes = vec![IAC, SB, NAWS];
        bytes.extend(escape(&[
            (cols >> 8) as u8,
            cols as u8,
            (rows >> 8) as u8,
            rows as u8,
        ]));
        bytes.extend_from_slice(&[IAC, SE]);
        bytes
    }

    /// A window-size report when the server accepted NAWS.
    pub fn resize(&mut self, cols: u16, rows: u16) -> Vec<u8> {
        self.size = (cols, rows);
        if self.local[NAWS as usize] {
            self.naws_bytes()
        } else {
            Vec::new()
        }
    }
}

/// Doubles IAC bytes in data sent to the server.
pub fn escape(bytes: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(bytes.len());
    for &byte in bytes {
        out.push(byte);
        if byte == IAC {
            out.push(IAC);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn telnet() -> Telnet {
        Telnet::new("xterm-256color".into(), 120, 30)
    }

    #[test]
    fn strips_protocol_from_data_across_chunks() {
        let mut telnet = telnet();
        let mut data = telnet.receive(b"ab\xff").data;
        data.extend(telnet.receive(b"\xffc\xff\xf1d\xff").data);
        data.extend(telnet.receive(b"\xfa\x18\x01\xff").data);
        data.extend(telnet.receive(b"\xf0e").data);
        assert_eq!(data, b"ab\xffcde");
    }

    #[test]
    fn accepts_echo_and_sga_and_refuses_the_rest() {
        let mut telnet = telnet();
        let reply = telnet
            .receive(&[IAC, WILL, ECHO, IAC, WILL, SGA, IAC, WILL, 5])
            .reply;
        assert_eq!(reply, [IAC, DO, ECHO, IAC, DO, SGA, IAC, DONT, 5]);
        // Repeated offers of agreed options are not answered again.
        assert!(telnet.receive(&[IAC, WILL, ECHO]).reply.is_empty());
        assert_eq!(telnet.receive(&[IAC, DO, 36]).reply, [IAC, WONT, 36]);
        assert!(telnet.receive(&[IAC, WONT, 36]).reply.is_empty());
    }

    #[test]
    fn reports_terminal_type_and_window_size() {
        let mut telnet = telnet();
        let reply = telnet.receive(&[IAC, DO, NAWS]).reply;
        assert_eq!(
            reply,
            [IAC, WILL, NAWS, IAC, SB, NAWS, 0, 120, 0, 30, IAC, SE]
        );
        assert!(telnet.receive(&[IAC, DO, NAWS]).reply.is_empty());

        assert_eq!(telnet.receive(&[IAC, DO, TTYPE]).reply, [IAC, WILL, TTYPE]);
        let reply = telnet.receive(&[IAC, SB, TTYPE, TTYPE_SEND, IAC, SE]).reply;
        let mut expected = vec![IAC, SB, TTYPE, TTYPE_IS];
        expected.extend_from_slice(b"xterm-256color");
        expected.extend_from_slice(&[IAC, SE]);
        assert_eq!(reply, expected);

        // 255 columns needs escaping inside the subnegotiation.
        assert_eq!(
            telnet.resize(255, 40),
            [IAC, SB, NAWS, 0, IAC, IAC, 0, 40, IAC, SE]
        );
    }

    #[test]
    fn resize_before_naws_is_silent() {
        assert!(telnet().resize(100, 20).is_empty());
    }

    #[test]
    fn escapes_iac_in_input() {
        assert_eq!(escape(b"a\xffb"), b"a\xff\xffb");
    }
}
