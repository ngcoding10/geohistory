"""Read members of a remote zip file with HTTP range requests, so that a few files can be taken from a
multi-gigabyte archive without downloading all of it. Used for the HYDE population grids."""
import io
import time
import urllib.request

from common import UA, log


class RangeFile(io.RawIOBase):
    def __init__(self, url, size=None):
        self.url, self.pos = url, 0
        self.size = size if size is not None else self._size()
        self.real = None

    def _resolve(self):
        for attempt in range(6):
            try:
                return self._resolve1()
            except Exception as e:   # noqa: BLE001
                log(f'  resolve failed ({e}); retrying')
                time.sleep(5 * (attempt + 1))
        raise RuntimeError('cannot reach ' + self.url)

    def _resolve1(self):
        # the repository redirects to a signed object-store URL that expires after an hour: resolve again then
        # (a HEAD request is refused by the signed URL, so ask for the first byte)
        req = urllib.request.Request(self.url, headers={'User-Agent': UA, 'Range': 'bytes=0-0'})
        with urllib.request.urlopen(req, timeout=60) as r:
            self.real, self.real_t = r.geturl(), time.time()
            return int(r.headers['Content-Range'].rsplit('/', 1)[1])

    def _size(self):
        return self._resolve()

    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else (self.pos + off if whence == 1 else self.size + off)
        return self.pos

    def read(self, n=-1):
        if n is None or n < 0:
            n = self.size - self.pos
        n = min(n, self.size - self.pos)
        if n <= 0:
            return b''
        for attempt in range(6):
            if self.real is None or time.time() - self.real_t > 1800:
                self._resolve()
            req = urllib.request.Request(self.real, headers={'User-Agent': UA, 'Range': f'bytes={self.pos}-{self.pos + n - 1}'})
            try:
                with urllib.request.urlopen(req, timeout=300) as r:
                    data = r.read()
                break
            except Exception as e:   # noqa: BLE001 (network: retry with a fresh URL)
                log(f'  range read failed ({e}); retrying')
                self.real = None
                time.sleep(5 * (attempt + 1))
        else:
            raise RuntimeError('range read failed')
        self.pos += len(data)
        return data

    def readinto(self, b):
        d = self.read(len(b))
        b[:len(d)] = d
        return len(d)
