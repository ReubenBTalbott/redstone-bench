"""Minimal RCON client (stdlib only)."""
import socket
import struct


class Rcon:
    def __init__(self, host="127.0.0.1", port=25592, password=""):
        self.sock = socket.create_connection((host, port), timeout=30)
        self._id = 0
        self._send(3, password)
        rid, _, _ = self._recv()
        if rid == -1:
            raise RuntimeError("RCON auth failed")

    def _send(self, kind, body):
        self._id += 1
        payload = struct.pack("<ii", self._id, kind) + body.encode() + b"\x00\x00"
        self.sock.sendall(struct.pack("<i", len(payload)) + payload)

    def _read(self, n):
        buf = b""
        while len(buf) < n:
            chunk = self.sock.recv(n - len(buf))
            if not chunk:
                raise ConnectionError("RCON closed")
            buf += chunk
        return buf

    def _recv(self):
        (length,) = struct.unpack("<i", self._read(4))
        data = self._read(length)
        rid, kind = struct.unpack("<ii", data[:8])
        return rid, kind, data[8:-2].decode(errors="replace")

    def cmd(self, command):
        self._send(2, command)
        return self._recv()[2]

    def close(self):
        self.sock.close()
