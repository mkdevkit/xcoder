use std::path::{Path, PathBuf};
use std::process::Command;

/// Resolve a CLI executable, including npm global shims missing from GUI app PATH.
pub fn resolve_executable(name: &str) -> Result<PathBuf, String> {
    if Path::new(name).is_absolute() || name.contains(std::path::MAIN_SEPARATOR) {
        return normalize_program_path(PathBuf::from(name));
    }

    #[cfg(windows)]
    if let Some(path) = resolve_npm_shim(name) {
        return Ok(path);
    }

    if let Some(path) = find_on_path(name) {
        return normalize_program_path(path);
    }

    for candidate in extra_candidates(name) {
        if candidate.exists() {
            return normalize_program_path(candidate);
        }
    }

    Err(format!(
        "未找到 {name}。请安装: npm install -g {name}，或在配置文件中指定 codewhale.cmd 的完整路径。"
    ))
}

pub fn build_command(program: &Path, args: &[&str]) -> Command {
    let mut cmd = if should_run_via_cmd(program) {
        let mut command = Command::new("cmd");
        command.arg("/C").arg(program);
        command.args(args);
        command
    } else {
        let mut command = Command::new(program);
        command.args(args);
        command
    };

    augment_path(&mut cmd);

    // npm global shims (codewhale.cmd / opencode.cmd) run via cmd.exe; without this
    // flag Windows allocates a visible console when xcoder is built as a GUI app.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    cmd
}

fn normalize_program_path(path: PathBuf) -> Result<PathBuf, String> {
    if !path.exists() {
        return Err(format!("Command not found: {}", path.display()));
    }

    #[cfg(windows)]
    {
        if should_run_via_cmd(&path) {
            return Ok(path);
        }

        let cmd_path = path.with_extension("cmd");
        if cmd_path.exists() {
            return Ok(cmd_path);
        }

        if let Some(parent) = path.parent() {
            let base = path.file_name().and_then(|s| s.to_str()).unwrap_or("");
            let sibling = parent.join(format!("{base}.cmd"));
            if sibling.exists() {
                return Ok(sibling);
            }
        }
    }

    Ok(path)
}

#[cfg(windows)]
fn resolve_npm_shim(name: &str) -> Option<PathBuf> {
    let appdata = std::env::var_os("APPDATA")?;
    let npm_dir = PathBuf::from(appdata).join("npm");
    let cmd = npm_dir.join(format!("{name}.cmd"));
    if cmd.exists() {
        return Some(cmd);
    }
    None
}

#[cfg(not(windows))]
fn resolve_npm_shim(_name: &str) -> Option<PathBuf> {
    None
}

fn should_run_via_cmd(program: &Path) -> bool {
    #[cfg(windows)]
    {
        matches!(
            program.extension().and_then(|s| s.to_str()),
            Some("cmd" | "bat")
        )
    }
    #[cfg(not(windows))]
    {
        let _ = program;
        false
    }
}

fn find_on_path(name: &str) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        for candidate in candidate_names(name) {
            let full = dir.join(&candidate);
            if full.exists() {
                return Some(full);
            }
        }
    }
    None
}

fn extra_candidates(name: &str) -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Some(home) = dirs::home_dir() {
        candidates.push(home.join(".cargo").join("bin").join(format!("{name}.exe")));
        candidates.push(home.join(".cargo").join("bin").join(name));
        #[cfg(not(windows))]
        candidates.push(home.join(".local").join("bin").join(name));
    }

    if let Some(appdata) = std::env::var_os("APPDATA") {
        let npm = PathBuf::from(appdata).join("npm");
        for file_name in candidate_names(name) {
            candidates.push(npm.join(file_name));
        }
    }

    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        let npm = PathBuf::from(local).join("npm");
        for file_name in candidate_names(name) {
            candidates.push(npm.join(file_name));
        }
    }

    candidates
}

fn candidate_names(name: &str) -> Vec<String> {
    #[cfg(windows)]
    {
        vec![
            format!("{name}.cmd"),
            format!("{name}.exe"),
            format!("{name}.bat"),
            name.to_string(),
        ]
    }
    #[cfg(not(windows))]
    {
        vec![name.to_string()]
    }
}

fn augment_path(cmd: &mut Command) {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();

    for extra in extra_path_dirs() {
        if !dirs.iter().any(|d| d == &extra) {
            dirs.insert(0, extra);
        }
    }

    if let Ok(joined) = std::env::join_paths(&dirs) {
        cmd.env("PATH", joined);
    }
}

fn extra_path_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();

    if let Some(appdata) = std::env::var_os("APPDATA") {
        dirs.push(PathBuf::from(appdata).join("npm"));
    }
    if let Some(home) = dirs::home_dir() {
        dirs.push(home.join(".cargo").join("bin"));
    }

    dirs
}
