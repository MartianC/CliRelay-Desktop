// 发布版 Windows 下不额外打开控制台窗口。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    clirelay_desktop_lib::run()
}
