//! Stable-toolchain robustness tests: the fuzz harnesses driven by seeded
//! random inputs built from protocol-shaped tokens and raw bytes, at random
//! chunkings. `FUZZ_HARNESS_ITERS=<n>` runs more cases (default 400 per
//! target); `FUZZ_HARNESS_SEED=<n>` changes the base seed. A failure prints
//! the input as a fuzz-target reproducer.

use fuzz_harness::{
    make_input, zmodem_bin_header, zmodem_hex_header, zmodem_subpacket, Rng, ZMODEM_INTRO,
};

fn iterations() -> usize {
    std::env::var("FUZZ_HARNESS_ITERS")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(400)
}

fn base_seed() -> u64 {
    std::env::var("FUZZ_HARNESS_SEED")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(0x51_4D_50_4C_45)
}

/// Runs `target` on `iterations()` inputs of random tokens and bytes.
fn drive(name: &str, tokens: &[&[u8]], max_pieces: usize, target: fn(&[u8])) {
    let mut rng = Rng::new(base_seed() ^ ((name.len() as u64) << 32) ^ name.as_bytes()[0] as u64);
    for _ in 0..iterations() {
        let mut body = Vec::new();
        for _ in 0..rng.below(max_pieces) + 1 {
            if rng.below(3) == 0 {
                for _ in 0..rng.below(8) + 1 {
                    body.push(rng.next_u64() as u8);
                }
            } else {
                body.extend_from_slice(tokens[rng.below(tokens.len())]);
            }
        }
        let input = make_input(rng.next_u64(), &body);
        if std::panic::catch_unwind(|| target(&input)).is_err() {
            panic!("{name} failed; reproducer input: {input:?}");
        }
    }
}

/// Fixed samples at many chunkings.
fn samples(target: fn(&[u8]), samples: &[&[u8]]) {
    for sample in samples {
        for seed in 0..64u64 {
            target(&make_input(
                seed.wrapping_mul(0x9E37_79B9_7F4A_7C15),
                sample,
            ));
        }
    }
}

#[test]
fn term_pipe_survives_random_terminal_output() {
    let tokens: &[&[u8]] = &[
        b"\x1b",
        b"\x1b]",
        b"\x1b]0;title",
        b"\x1b]8;;https://example.com",
        b"\x07",
        b"\x1b\\",
        "\u{9c}".as_bytes(),
        "\u{9d}".as_bytes(),
        b"\x18",
        b"\x1a",
        b"\x1b[31m",
        b"\x1b[0m",
        b"\x1b[1;32m",
        b"\x1b[38:5:1m",
        b"\x1b[999999999999999999999999m",
        b"\x1b[K",
        b"\r\n",
        b" ",
        b"error",
        b"failed",
        b"WARN",
        b"ok",
        b"vim file",
        b"less",
        b":q",
        b"  :wq\r\n",
        b"exit",
        b"10.0.0.1:22",
        b"fe80::1",
        b"aa:bb:cc:dd:ee:ff",
        b"2026-10-25 12:00:01",
        b"https://x.io/p?a=b",
        b"/var/log/syslog",
        b"C:\\tmp\\a",
        b"$HOME ${PATH} FOO=bar",
        b"550e8400-e29b-41d4-a716-446655440000",
        b"root@box-a1b2c3d4:~# ",
        b"__OSC_PLACEHOLDER_0__",
        b"$& $' $` $$",
        "中文😀é".as_bytes(),
        &"中".as_bytes()[..2],
        &"😀".as_bytes()[..3],
        b"\xff",
        b"\xc0\x80",
        b"\xed\xa0\x80",
        b"\xf4\x90\x80\x80",
        b"\xe0",
        b"\xf0\x9f",
    ];
    drive("term_pipe", tokens, 24, fuzz_harness::term_pipe);
    samples(
        fuzz_harness::term_pipe,
        &[
            "中 error\x1b]0;error\x07 less".as_bytes(),
            b"ab\x1b]0;ti\x1b\\cd\x1b",
            b"\x1b]0;root@box-a1b2c3d4: $&\x07root@box-a1b2c3d4:~# vim\r\n:wq\r\n",
            b"\xe4\xb8",
            b"\x1b",
        ],
    );
}

#[test]
fn telnet_survives_random_negotiation() {
    let tokens: &[&[u8]] = &[
        &[255],
        &[255, 255],
        &[255, 251, 1],
        &[255, 251, 3],
        &[255, 251, 5],
        &[255, 252, 1],
        &[255, 253, 24],
        &[255, 253, 31],
        &[255, 253, 36],
        &[255, 254, 31],
        &[255, 254, 24],
        &[255, 250, 24, 1, 255, 240],
        &[255, 250, 24, 1],
        &[255, 250],
        &[255, 240],
        &[255, 241],
        &[255, 249],
        b"login: ",
        b"Username:",
        "用户名：".as_bytes(),
        b"Password: ",
        "密码:".as_bytes(),
        b"\r\n",
        b"text",
    ];
    drive("telnet", tokens, 32, fuzz_harness::telnet);
    let long_sub: Vec<u8> = [&[255u8, 250][..], &[7; 3000], &[255, 255, 255, 240]].concat();
    samples(
        fuzz_harness::telnet,
        &[
            b"ab\xff\xffc\xff\xf1d\xff\xfa\x18\x01\xff\xf0e",
            &[255, 253, 31, 255, 253, 24, 255, 250, 24, 1, 255, 240],
            &long_sub,
        ],
    );
}

#[test]
fn zmodem_detector_survives_random_streams() {
    let zrqinit = zmodem_hex_header(0, [0; 4]);
    let zrinit = zmodem_hex_header(1, [0, 4, 0, 0x23]);
    let zsinit = zmodem_hex_header(2, [0; 4]);
    let zrpos = zmodem_hex_header(9, [0; 4]);
    let zrpos_far = zmodem_hex_header(9, [0xff, 0xff, 0xff, 0x7f]);
    let zfin = zmodem_hex_header(8, [0; 4]);
    let zskip = zmodem_hex_header(5, [0; 4]);
    let zabort = zmodem_hex_header(7, [0; 4]);
    let zack = zmodem_hex_header(3, [0; 4]);
    let zfile = zmodem_hex_header(4, [0; 4]);
    let zdata = zmodem_bin_header(10, [0; 4]);
    let zdata_far = zmodem_bin_header(10, [0x10, 0, 0, 0]);
    let zfile_bin = zmodem_bin_header(4, [0; 4]);
    let zeof = zmodem_hex_header(11, [0x10, 0, 0, 0]);
    let file_info = zmodem_subpacket(b"name.txt\x0016 0 0\x00", b'k');
    let odd_info = zmodem_subpacket(b"\x18\x11../\xff\x00-1 zz\x00", b'k');
    let chunk_g = zmodem_subpacket(b"0123456789abcdef", b'i');
    let chunk_e = zmodem_subpacket(&[0x18, 0x11, 0x13, 0x90, 0xff, 0], b'h');
    let chunk_q = zmodem_subpacket(b"", b'j');
    let tokens: &[&[u8]] = &[
        ZMODEM_INTRO,
        b"**\x18B",
        b"**\x18B00",
        b"**\x18B01",
        b"**\x18B02",
        b"*\x18A",
        b"*\x18C",
        &zrqinit,
        &zrinit,
        &zsinit,
        &zrpos,
        &zrpos_far,
        &zfin,
        &zskip,
        &zabort,
        &zack,
        &zfile,
        &zdata,
        &zdata_far,
        &zfile_bin,
        &zeof,
        b"name.txt\x00123 0 0\x00",
        &file_info,
        &odd_info,
        &chunk_g,
        &chunk_e,
        &chunk_q,
        b"\x18h",
        b"\x18i",
        b"\x18j",
        b"\x18k",
        b"\x18\x18\x18\x18\x18\x08\x08\x08\x08\x08",
        b"\x18",
        b"\x18l",
        b"\x18m",
        b"\r\n\x11",
        b"OO",
        b"plain shell output\r\n",
    ];
    drive("zmodem", tokens, 24, fuzz_harness::zmodem);
    samples(
        fuzz_harness::zmodem,
        &[
            b"before**\x18B00000000000000\r\n\x11after",
            b"**\x18B0**\x18B0**\x18B02",
            b"**\x18",
            &[&zrqinit[..], &zfile, b"a.txt\x0010\x00\x18k", &zfin].concat(),
            &[
                &zrqinit[..],
                &zfile_bin,
                &file_info,
                &zdata,
                &chunk_g,
                &zeof,
                &zfin,
                b"OO",
            ]
            .concat(),
            &[&zrinit[..], &zrpos, &zrpos_far, &zack, &zfin, b"OO"].concat(),
        ],
    );
}

/// The control target without the chunking seed.
fn control_body(data: &[u8]) {
    fuzz_harness::control(fuzz_harness::split_input(data).1);
}

#[test]
fn frame_codec_survives_random_streams() {
    let ping = br#"{"schemaVersion":1,"op":"ping","id":7}"#;
    let open = br#"{"schemaVersion":1,"op":"open","stream":2,"service":"pty","args":["a"]}"#;
    let exit = br#"{"schemaVersion":1,"op":"exit","stream":2,"code":null,"signal":"SIGTERM","error":null}"#;
    let frame = |kind: u8, stream: u32, payload: &[u8]| {
        let mut out = ((payload.len() + 5) as u32).to_le_bytes().to_vec();
        out.push(kind);
        out.extend_from_slice(&stream.to_le_bytes());
        out.extend_from_slice(payload);
        out
    };
    let control_ping = frame(1, 0, ping);
    let control_open = frame(1, 0, open);
    let control_exit = frame(1, 0, exit);
    let data = frame(2, 3, b"hello");
    let unknown = frame(9, 1, b"");
    let tokens: &[&[u8]] = &[
        &control_ping,
        &control_open,
        &control_exit,
        &data,
        &unknown,
        &[0, 0, 0, 0],
        &[4, 0, 0, 0],
        &[5, 0, 0, 0, 2, 1, 0, 0, 0],
        &[0xff, 0xff, 0xff, 0xff],
        &[6, 0, 0, 1],
        ping,
        br#"{"schemaVersion":1,"op":"shutdown"}"#,
        br#"{"schemaVersion":2,"op":"ping","id":1}"#,
        br#"{"op":"error","schemaVersion":1,"stream":null,"message":"\u00e9\ud83d\ude00"}"#,
    ];
    drive("frame_codec", tokens, 12, fuzz_harness::frame_codec);
    drive("control", tokens, 3, control_body);
    samples(
        fuzz_harness::frame_codec,
        &[&control_ping, &[&data[..], &unknown, &data].concat()],
    );
}
