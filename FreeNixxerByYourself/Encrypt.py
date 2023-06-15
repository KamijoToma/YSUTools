import base64
import random
from Crypto.Cipher import AES
from Crypto.Util.Padding import pad

def _gas(data, key0, iv0):
    key = key0.strip().encode('utf-8')
    iv = iv0.strip().encode('utf-8')
    cipher = AES.new(key, AES.MODE_CBC, iv)
    encrypted = cipher.encrypt(pad(data.encode('utf-8'), AES.block_size))
    return base64.b64encode(encrypted).decode('utf-8')

def encryptAES(data, _p1):
    ## Used by CAS Server to encrypt password.
    ## Pattern: encryptAES(pwd, key), key can be found from HTML.
    if not _p1:
        return data
    random_str = _rds(64) + data
    encrypted = _gas(random_str, _p1, _rds(16))
    return encrypted

def _ep(p0, p1):
    try:
        return encryptAES(p0, p1)
    except Exception as e:
        pass
    return p0

_chars = 'ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678'
_chars_len = len(_chars)

def _rds(length):
    ret_str = ''.join(random.choice(_chars) for _ in range(length))
    return ret_str

if __name__ == '__main__':
    # Test
    print(encryptAES('114514', '2kFjJD1gPrBXW3l7'))
