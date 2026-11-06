using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Security.Principal;
using System.Windows.Forms;

namespace BiliProgress
{
    internal static class Program
    {
        internal const string Title = "B站客户端视频进度插件";

        [STAThread]
        private static int Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            // 构建脚本用这个入口生成测试副本。
            if (args.Length == 3 && args[0] == "--prepare")
            {
                try { Installer.Prepare(args[1], args[2]); return 0; }
                catch (Exception err) { File.WriteAllText(args[2] + ".error.txt", err.ToString()); return 1; }
            }

            if (args.Length == 2 && (args[0] == "--install" || args[0] == "--uninstall"))
                return Run(Path.GetFullPath(args[1]), args[0] == "--uninstall") ? 0 : 1;

            Application.Run(new SetupForm());
            return 0;
        }

        internal static bool IsAdmin()
        {
            var user = new WindowsPrincipal(WindowsIdentity.GetCurrent());
            return user.IsInRole(WindowsBuiltInRole.Administrator);
        }

        internal static bool Run(string dir, bool uninstall)
        {
            try
            {
                if (uninstall) Installer.Uninstall(dir);
                else Installer.Install(dir);
                MessageBox.Show(uninstall ? "已卸载插件，观看记录保留。" :
                    "安装完成，重新打开哔哩哔哩即可。", Title);
                return true;
            }
            catch (Exception err)
            {
                MessageBox.Show(err.Message, Title, MessageBoxButtons.OK, MessageBoxIcon.Information);
                return false;
            }
        }
    }

    internal sealed class SetupForm : Form
    {
        private readonly TextBox pathBox;

        internal SetupForm()
        {
            Text = Program.Title;
            ClientSize = new Size(590, 360);
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            AutoScaleMode = AutoScaleMode.Dpi;
            Font = new Font("Microsoft YaHei UI", 10);

            var info = new Label
            {
                Left = 24, Top = 22, Width = 546, Height = 208,
                Text = "播放全部：恢复记录的分P和时间。\n" +
                    "直接选分P：提示上次位置，可手动跳转。\n" +
                    "（注：先回到系列开头，再可选择从整个合集开头播放。）\n" +
                    "使用原有续播弹窗，自动跳转可撤回。\n\n" +
                    "目前仅验证 Windows 客户端启动包 1.17.2 / 界面热更新 1.20.0。\n" +
                    "首次安装后打开可能会卡退，重新启动即可。\n" +
                    "安装前请从托盘完全退出客户端。"
            };
            pathBox = new TextBox
            {
                Text = Installer.DetectPath(), Left = 24, Top = 238, Width = 438,
                AccessibleName = "客户端安装目录"
            };
            var browse = new Button { Text = "选择…", Left = 474, Top = 236, Width = 90, Height = 30 };
            var install = new Button { Text = "安装到客户端", Left = 24, Top = 295, Width = 160, Height = 38 };
            var uninstall = new Button { Text = "卸载并恢复", Left = 198, Top = 295, Width = 145, Height = 38 };

            browse.Click += (sender, args) => Browse();
            install.Click += (sender, args) => Run(false);
            uninstall.Click += (sender, args) => Run(true);
            Controls.AddRange(new Control[] { info, pathBox, browse, install, uninstall });
        }

        private void Browse()
        {
            using (var dialog = new FolderBrowserDialog
            {
                Description = "选择包含哔哩哔哩.exe 的安装文件夹",
                SelectedPath = pathBox.Text
            })
                if (dialog.ShowDialog() == DialogResult.OK) pathBox.Text = dialog.SelectedPath;
        }

        private void Run(bool uninstall)
        {
            try
            {
                string dir = Path.GetFullPath(pathBox.Text.Trim());
                if (!File.Exists(Path.Combine(dir, "resources", "app.asar")))
                    throw new DirectoryNotFoundException("请选择哔哩哔哩的安装文件夹。");
                Installer.EnsureClosed(dir);

                if (Program.IsAdmin())
                {
                    Program.Run(dir, uninstall);
                    return;
                }

                // 安装到 Program Files 时，由 Windows 请求管理员权限。
                Process.Start(new ProcessStartInfo
                {
                    FileName = Assembly.GetExecutingAssembly().Location,
                    Arguments = (uninstall ? "--uninstall " : "--install ") + "\"" + dir + "\"",
                    UseShellExecute = true,
                    Verb = "runas"
                });
            }
            catch (System.ComponentModel.Win32Exception err)
            {
                if (err.NativeErrorCode != 1223) MessageBox.Show(err.Message, Program.Title);
            }
            catch (Exception err) { MessageBox.Show(err.Message, Program.Title); }
        }
    }
}
