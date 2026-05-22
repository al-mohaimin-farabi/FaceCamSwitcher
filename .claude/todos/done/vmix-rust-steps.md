# Todos: Rust vMix Integration

- [x] Remove rust_socketio, urlencoding from Cargo.toml
- [x] Remove Player, FetchPlayersResponse structs
- [x] Replace ServerConfig with VmixConfig struct
- [x] Add player_camera_map to AppConfig
- [x] Update OcrState (remove sio fields, add vmix dedup fields)
- [x] Update default config JSON
- [x] Remove run_socketio_loop, auto_fetch_players, fetch_players_from_server, check_server_health
- [x] Add call_vmix_set_layer() async fn
- [x] Add test_vmix_connection command
- [x] Rewrite run_ocr_loop with debounce + clear-timeout + vMix dispatch
- [x] Update start_ocr (no socketio spawn)
- [x] Update stop_ocr (no ws_status emit)
- [x] Update invoke_handler registration
