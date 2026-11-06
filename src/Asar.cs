using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;

namespace BiliProgress
{
    // ASAR 的文件头记录路径和偏移，后面是连续的文件内容。
    internal sealed class Asar
    {
        private const int BlockSize = 4 * 1024 * 1024;
        private readonly byte[] data;
        private readonly int dataOffset;
        private readonly Dictionary<string, object> header;

        internal static readonly JavaScriptSerializer Json = new JavaScriptSerializer
        {
            MaxJsonLength = 32 * 1024 * 1024,
            RecursionLimit = 100
        };

        internal Asar(string path)
        {
            data = File.ReadAllBytes(path);
            if (data.Length < 16 || BitConverter.ToUInt32(data, 0) != 4)
                throw new InvalidDataException("无法读取客户端资源包。");

            dataOffset = checked(8 + (int)BitConverter.ToUInt32(data, 4));
            int size = checked((int)BitConverter.ToUInt32(data, 12));
            if (dataOffset > data.Length || size < 2 || size > dataOffset - 16)
                throw new InvalidDataException("客户端资源包的文件头不完整。");

            header = Json.Deserialize<Dictionary<string, object>>(
                Encoding.UTF8.GetString(data, 16, size));
        }

        private Dictionary<string, object> Find(string path, bool create)
        {
            var node = header;
            foreach (string part in path.Split('/'))
            {
                if (!node.ContainsKey("files"))
                {
                    if (!create) throw new FileNotFoundException("客户端缺少文件：" + path);
                    node["files"] = new Dictionary<string, object>();
                }

                var files = (Dictionary<string, object>)node["files"];
                if (!files.ContainsKey(part))
                {
                    if (!create) throw new FileNotFoundException("客户端缺少文件：" + path);
                    files[part] = new Dictionary<string, object>();
                }
                node = (Dictionary<string, object>)files[part];
            }
            return node;
        }

        internal byte[] Read(string path)
        {
            var node = Find(path, false);
            int offset = checked(dataOffset + Convert.ToInt32(node["offset"]));
            int size = Convert.ToInt32(node["size"]);
            if (offset < dataOffset || size < 0 || size > data.Length - offset)
                throw new InvalidDataException("客户端文件不完整：" + path);

            var bytes = new byte[size];
            Buffer.BlockCopy(data, offset, bytes, 0, size);
            return bytes;
        }

        internal string ReadText(string path)
        {
            return Encoding.UTF8.GetString(Read(path));
        }

        internal static string Hash(byte[] bytes)
        {
            using (var sha = SHA256.Create())
                return Hex(sha.ComputeHash(bytes));
        }

        internal static string HashFile(string path)
        {
            using (var sha = SHA256.Create())
            using (var file = File.OpenRead(path))
                return Hex(sha.ComputeHash(file));
        }

        private static string Hex(byte[] bytes)
        {
            return BitConverter.ToString(bytes).Replace("-", "").ToLowerInvariant();
        }

        private static object Integrity(byte[] bytes)
        {
            var blocks = new List<string>();
            for (int offset = 0; offset < bytes.Length; offset += BlockSize)
            {
                var block = new byte[Math.Min(BlockSize, bytes.Length - offset)];
                Buffer.BlockCopy(bytes, offset, block, 0, block.Length);
                blocks.Add(Hash(block));
            }
            return new Dictionary<string, object>
            {
                { "algorithm", "SHA256" },
                { "hash", Hash(bytes) },
                { "blockSize", BlockSize },
                { "blocks", blocks.ToArray() }
            };
        }

        internal void Write(string output, IDictionary<string, byte[]> changes)
        {
            // 新内容追加到文件尾，只更新对应条目的偏移和校验值。
            long offset = data.Length - dataOffset;
            foreach (var change in changes)
            {
                var node = Find(change.Key, true);
                node["offset"] = offset.ToString();
                node["size"] = change.Value.Length;
                node["integrity"] = Integrity(change.Value);
                node.Remove("unpacked");
                offset += change.Value.Length;
            }

            byte[] json = Encoding.UTF8.GetBytes(Json.Serialize(header));
            int payloadSize = (4 + json.Length + 3) & ~3; // Pickle 按 4 字节对齐。
            using (var stream = new FileStream(output, FileMode.CreateNew, FileAccess.Write))
            using (var writer = new BinaryWriter(stream))
            {
                writer.Write(4);
                writer.Write(4 + payloadSize);
                writer.Write(payloadSize);
                writer.Write(json.Length);
                writer.Write(json);
                writer.Write(new byte[payloadSize - 4 - json.Length]);
                writer.Write(data, dataOffset, data.Length - dataOffset);
                foreach (var change in changes) writer.Write(change.Value);
            }
        }
    }
}
