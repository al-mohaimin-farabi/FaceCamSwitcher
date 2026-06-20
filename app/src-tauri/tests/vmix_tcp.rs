//! Integration test: build a vMix command and send it over a real TCP socket.

use app_lib::vmix;
use std::io::Read;
use std::net::{TcpListener, TcpStream};
use std::sync::mpsc;

#[test]
fn sends_built_payload_over_tcp() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    let (tx, rx) = mpsc::channel::<String>();

    let server = std::thread::spawn(move || {
        if let Ok((mut stream, _)) = listener.accept() {
            let mut buf = [0u8; 1024];
            let n = stream.read(&mut buf).unwrap_or(0);
            let _ = tx.send(String::from_utf8_lossy(&buf[..n]).to_string());
        }
    });

    let mut client = TcpStream::connect(addr).unwrap();
    let payload = vmix::build_payload("CAM FEED", 2, "11838801107");
    vmix::send(&mut client, &payload).expect("send should succeed");

    let received = rx.recv().expect("server should receive data");
    assert_eq!(
        received,
        "FUNCTION SetMultiViewOverlay Input=CAM%20FEED&Value=2,11838801107\r\n"
    );

    server.join().ok();
}
