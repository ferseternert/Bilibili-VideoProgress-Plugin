using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text;

namespace BiliProgress
{
    internal static class Installer
    {
        internal const string Version = "0.1.0";
        private const string ClientVersion = "1.17.2";
        private const string MarkerName = "bili-progress-memory-install.json";
        private const string BackupName = "app.asar.bpm-original";

        private static byte[] Resource(string name)
        {
            using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(name))
            using (var buffer = new MemoryStream())
            {
                if (stream == null) throw new FileNotFoundException("安装包缺少文件：" + name);
                stream.CopyTo(buffer);
                return buffer.ToArray();
            }
        }

        private static Dictionary<string, byte[]> BuildPatch(Asar archive)
        {
            var package = Asar.Json.Deserialize<Dictionary<string, object>>(
                archive.ReadText("package.json"));
            string version = Convert.ToString(package["version"]);
            if (version != ClientVersion)
                throw new InvalidOperationException("当前启动包版本为 " + version +
                    "，本版安装器支持 " + ClientVersion + "。");

            string main = archive.ReadText("index.js");
            if (main.Contains("bpm-main.js"))
                throw new InvalidOperationException("插件已安装，请先卸载旧版。");

            return new Dictionary<string, byte[]>
            {
                { "index.js", Encoding.UTF8.GetBytes(
                    "try { require('./bpm-main.js'); } catch (_) {}\n" + main) },
                { "bpm-main.js", Resource("main.js") },
                { "bpm-core.js", Resource("core.js") },
                { "bpm-client.js", Resource("client.js") },
                { "bpm-extension.js", Resource("extension.js") }
            };
        }

        internal static void Prepare(string input, string output)
        {
            var archive = new Asar(input);
            archive.Write(output, BuildPatch(archive));
        }

        internal static void EnsureClosed(string dir)
        {
            foreach (var process in Process.GetProcessesByName("哔哩哔哩"))
            {
                try
                {
                    string path = Path.GetDirectoryName(process.MainModule.FileName);
                    if (string.Equals(path, dir, StringComparison.OrdinalIgnoreCase))
                        throw new InvalidOperationException("请先从托盘完全退出哔哩哔哩。");
                }
                catch (System.ComponentModel.Win32Exception) { }
                finally { process.Dispose(); }
            }
        }

        internal static void Install(string dir)
        {
            EnsureClosed(dir);
            string resources = Path.Combine(dir, "resources");
            string path = Path.Combine(resources, "app.asar");
            string marker = Path.Combine(resources, MarkerName);
            string backup = Path.Combine(resources, BackupName);

            if (File.Exists(marker)) throw new InvalidOperationException("插件已安装，请先卸载旧版。");
            if (File.Exists(backup)) throw new IOException("发现已有备份，请先恢复原客户端后再安装。");

            var archive = new Asar(path);
            var changes = BuildPatch(archive);
            string original = Asar.HashFile(path);
            string temp = path + ".bpm-" + Guid.NewGuid().ToString("N") + ".tmp";
            try
            {
                archive.Write(temp, changes);
                var result = new Asar(temp);
                foreach (var change in changes)
                    if (Asar.Hash(result.Read(change.Key)) != Asar.Hash(change.Value))
                        throw new IOException("文件校验失败，请重新运行安装器。");

                string patched = Asar.HashFile(temp);
                if (Asar.HashFile(path) != original)
                    throw new IOException("客户端正在更新，请更新完成后重试。");

                File.Replace(temp, path, backup);
                try
                {
                    var meta = new Dictionary<string, object>
                    {
                        { "version", Version }, { "client", ClientVersion },
                        { "original", original }, { "patched", patched },
                        { "installedAt", DateTime.UtcNow.ToString("o") }
                    };
                    File.WriteAllText(marker, Asar.Json.Serialize(meta), new UTF8Encoding(false));
                }
                catch
                {
                    // 安装记录写入失败时，恢复刚才的备份。
                    File.Replace(backup, path, null);
                    throw;
                }
            }
            finally { if (File.Exists(temp)) File.Delete(temp); }
        }

        internal static void Uninstall(string dir)
        {
            EnsureClosed(dir);
            string resources = Path.Combine(dir, "resources");
            string path = Path.Combine(resources, "app.asar");
            string marker = Path.Combine(resources, MarkerName);
            string backup = Path.Combine(resources, BackupName);
            if (!File.Exists(marker) || !File.Exists(backup))
                throw new FileNotFoundException("找不到安装记录或原文件备份。");

            var meta = Asar.Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(marker));
            if (Asar.HashFile(path) != Convert.ToString(meta["patched"]))
                throw new IOException("客户端已更新，请使用官方安装程序恢复客户端。");
            if (Asar.HashFile(backup) != Convert.ToString(meta["original"]))
                throw new IOException("备份文件不完整，请使用官方安装程序恢复客户端。");

            File.Replace(backup, path, null);
            File.Delete(marker);
        }

        internal static string DetectPath()
        {
            var paths = new[]
            {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "bilibili"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "bilibili")
            };
            foreach (string dir in paths)
                if (File.Exists(Path.Combine(dir, "resources", "app.asar"))) return dir;
            return "";
        }
    }
}
