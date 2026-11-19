"""Read-only DXGI adapter enumeration; LUIDs are boot-local, never hardcode them."""
import ctypes as c
import uuid
import json

class GUID(c.Structure):
    _fields_ = [('bytes', c.c_ubyte * 16)]
class LUID(c.Structure):
    _fields_ = [('low', c.c_uint32), ('high', c.c_int32)]
class DESC(c.Structure):
    _fields_ = [('description', c.c_wchar * 128), ('vendor', c.c_uint32), ('device', c.c_uint32), ('subsys', c.c_uint32), ('revision', c.c_uint32), ('dedicatedVideo', c.c_size_t), ('dedicatedSystem', c.c_size_t), ('shared', c.c_size_t), ('luid', LUID)]

def method(obj, index, result, *args):
    table = c.cast(obj, c.POINTER(c.POINTER(c.c_void_p))).contents
    return c.WINFUNCTYPE(result, c.c_void_p, *args)(table[index])

def adapters():
    dll = c.WinDLL('dxgi')
    create = dll.CreateDXGIFactory1
    create.argtypes = [c.POINTER(GUID), c.POINTER(c.c_void_p)]
    create.restype = c.c_int32
    guid = GUID((c.c_ubyte * 16).from_buffer_copy(uuid.UUID('770aae78-f26f-4dba-a829-253c83d1b387').bytes_le))
    factory = c.c_void_p()
    hr = create(c.byref(guid), c.byref(factory))
    if hr < 0: raise RuntimeError(f'CreateDXGIFactory1 HRESULT {hr}')
    rows = []
    try:
        for i in range(16):
            obj = c.c_void_p()
            hr = method(factory, 7, c.c_int32, c.c_uint, c.POINTER(c.c_void_p))(factory, i, c.byref(obj))
            if hr == -2005270526: break  # DXGI_ERROR_NOT_FOUND
            if hr < 0: raise RuntimeError(f'EnumAdapters HRESULT {hr}')
            try:
                desc = DESC()
                hr = method(obj, 8, c.c_int32, c.POINTER(DESC))(obj, c.byref(desc))
                if hr < 0: raise RuntimeError(f'GetDesc HRESULT {hr}')
                rows.append(dict(name=desc.description, vendor=desc.vendor, device=desc.device, luid=f'{desc.luid.high},{desc.luid.low}', dedicatedVideo=desc.dedicatedVideo, shared=desc.shared))
            finally: method(obj, 2, c.c_uint)(obj)
    finally: method(factory, 2, c.c_uint)(factory)
    return rows

if __name__ == '__main__': print(json.dumps(adapters(), indent=2))
