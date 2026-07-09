pub fn flag_value(args: &[String], flags: &[&str]) -> Option<String> {
    for (index, arg) in args.iter().enumerate() {
        if flags.iter().any(|flag| flag == &arg.as_str()) {
            return args.get(index + 1).cloned();
        }
    }
    None
}

pub fn runtime_http_base_url(args: &[String], default_host: &str, default_port: &str) -> String {
    let host = flag_value(args, &["--host", "--hostname", "-H"])
        .unwrap_or_else(|| default_host.to_string());
    let port = flag_value(args, &["--port", "-p"]).unwrap_or_else(|| default_port.to_string());
    format!("http://{host}:{port}")
}

pub fn default_opencode_serve_args() -> Vec<String> {
    vec![
        "serve".to_string(),
        "--hostname".to_string(),
        "127.0.0.1".to_string(),
        "--port".to_string(),
        "4096".to_string(),
    ]
}

pub fn serve_args_or_default(
    args: &[String],
    default_args: &[String],
) -> Vec<String> {
    if args.is_empty() {
        return default_args.to_vec();
    }
    args.to_vec()
}

pub fn opencode_serve_args_with_cors(args: &[String]) -> Vec<String> {
    let mut resolved = serve_args_or_default(args, &default_opencode_serve_args());
    if !resolved.iter().any(|arg| arg == "--cors") {
        resolved.extend([
            "--cors".to_string(),
            "http://localhost:1420".to_string(),
            "--cors".to_string(),
            "tauri://localhost".to_string(),
        ]);
    }
    resolved
}
