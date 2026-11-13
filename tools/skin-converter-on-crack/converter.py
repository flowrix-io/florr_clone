"""Local native SVG conversion, contour tracing and exact pixel skin export."""
import base64
import heapq
import io
import math
from pathlib import Path
import warnings

import numpy as np
from PIL import Image, ImageOps, ImageCms, UnidentifiedImageError
from pillow_heif import register_heif_opener

register_heif_opener(thumbnails=False)
Image.MAX_IMAGE_PIXELS = 40_000_000
warnings.simplefilter('error', Image.DecompressionBombWarning)
MAX_UPLOAD = 40 * 1024 * 1024


def unpack_svgz(data, name):
    if Path(name).suffix.lower() != '.svgz':
        return data, name
    import gzip
    try:
        with gzip.GzipFile(fileobj=io.BytesIO(data)) as stream:
            plain = stream.read(MAX_UPLOAD + 1)
    except (OSError, EOFError):
        raise ValueError('Invalid compressed SVG file.') from None
    if len(plain) > MAX_UPLOAD:
        raise ValueError('Expanded SVG exceeds the 40 MB limit.')
    return plain, str(Path(name).with_suffix('.svg'))


def decode(data, name='', frame=0):
    if not data or len(data) > MAX_UPLOAD:
        raise ValueError('Choose an image smaller than 40 MB.')
    data, name = unpack_svgz(data, name)
    notes = []
    ext = Path(name).suffix.lower()
    if ext == '.svg' or data.lstrip().startswith(b'<svg'):
        # No scripts, local files or network fetches, even inside CSS or <use>.
        from cairosvg.surface import PNGSurface
        def deny(*args, **kwargs):
            raise ValueError('SVG external resources are disabled. Embed the artwork in the SVG first.')
        from defusedxml import ElementTree
        import re
        root = ElementTree.fromstring(data)
        view = root.get('viewBox', '').replace(',', ' ').split()
        def dimension(key, default):
            match = re.match(r'^[0-9.]+', root.get(key, ''))
            return float(match[0]) if match else default
        w = dimension('width', float(view[2]) if len(view)==4 else 512)
        h = dimension('height', float(view[3]) if len(view)==4 else 512)
        if not math.isfinite(w+h) or w<=0 or h<=0: raise ValueError('Invalid SVG dimensions.')
        scale = min(1., 1024/max(w,h))
        data = PNGSurface.convert(bytestring=data, url_fetcher=deny, output_width=max(1,round(w*scale)), output_height=max(1,round(h*scale)))
        notes.append('SVG rasterized locally, preserving aspect ratio (maximum side 1024 px). Use the existing SVG converter for editable vector paths.')
    try:
        im = Image.open(io.BytesIO(data))
    except UnidentifiedImageError:
        if ext not in {'.dng','.cr2','.cr3','.nef','.arw','.raf','.rw2','.orf','.pef','.srw','.raw'}:
            raise ValueError('This image codec is not supported. Try exporting it as PNG, TIFF or SVG.') from None
        import rawpy
        with rawpy.imread(io.BytesIO(data)) as raw:
            im = Image.fromarray(raw.postprocess(use_camera_wb=True, output_bps=8))
        notes.append('Camera RAW developed to 8-bit RGB with camera white balance.')
    fmt = im.format or ('RAW' if ext != '.svg' else 'SVG')
    frames = getattr(im, 'n_frames', 1)
    frame = max(0, min(int(frame), min(frames - 1, 499)))
    im.seek(frame)
    im = ImageOps.exif_transpose(im)
    icc = im.info.get('icc_profile')
    if icc:
        try:
            alpha = im.convert('RGBA').getchannel('A')
            im = ImageCms.profileToProfile(im.convert('RGB'), io.BytesIO(icc), ImageCms.createProfile('sRGB'), outputMode='RGB')
            im.putalpha(alpha)
        except (ValueError, OSError, ImageCms.PyCMSError):
            notes.append('Embedded color profile could not be converted; using decoded RGB values.')
    im = im.convert('RGBA')
    if im.width * im.height > Image.MAX_IMAGE_PIXELS:
        raise ValueError('Image is too large. Maximum decoded size is 40 megapixels.')
    return im, {'format': fmt, 'width': im.width, 'height': im.height, 'frames': frames, 'frame': frame, 'notes': notes}


def png(im):
    b = io.BytesIO(); im.save(b, format='PNG')
    return 'data:image/png;base64,' + base64.b64encode(b.getvalue()).decode()


def convert_file(data, name='', frame=0, options=None):
    """Decode once; retain supported SVG geometry instead of tracing its pixels."""
    options = options or {}
    if not data or len(data) > MAX_UPLOAD:
        raise ValueError('Choose an image smaller than 40 MB.')
    data, name = unpack_svgz(data, name)
    im, meta = decode(data, name, frame)  # validates XML/resources before native parsing
    is_svg = Path(name).suffix.lower() == '.svg' or data.lstrip().startswith(b'<svg')
    if is_svg and options.get('mode', 'game') != 'exact' and options.get('style', 'auto') in ('auto', 'vector'):
        import json
        import subprocess
        from defusedxml import ElementTree
        from cairosvg import svg2png
        import xml.etree.ElementTree as XML
        XML.register_namespace('', 'http://www.w3.org/2000/svg')
        XML.register_namespace('xlink', 'http://www.w3.org/1999/xlink')
        root = ElementTree.fromstring(data)
        if not root.get('viewBox'):
            root.set('viewBox', f'0 0 {im.width} {im.height}')
        size = max(8, min(100, float(options.get('size', 46))))
        budget = max(8, min(511, int(options.get('budget', 511))))
        request = {'svg': ElementTree.tostring(root, encoding='unicode'), 'size': size, 'budget': budget}
        process = subprocess.run(['node', str(Path(__file__).with_name('svg-native.js'))],
                                 input=json.dumps(request), text=True, capture_output=True, timeout=20)
        if process.returncode:
            raise ValueError('The native SVG converter failed. Try the Soft detail look.')
        native = json.loads(process.stdout)
        # Flowrix may drop holes, unsupported features or excess shapes. Never
        # silently ship those omissions: trace the complete rendered image instead.
        if native['shapes'] and not native['warnings']:
            from cairosvg.surface import PNGSurface
            def deny(*args, **kwargs):
                raise ValueError('SVG external resources are disabled.')
            root.set('width', '512'); root.set('height', '512')
            target = Image.open(io.BytesIO(PNGSurface.convert(
                bytestring=ElementTree.tostring(root), url_fetcher=deny))).convert('RGBA')
            out = Image.open(io.BytesIO(svg2png(bytestring=native['preview'].encode()))).convert('RGBA')
            loss = error(target, out)
            code = native['commands']
            meta['format'] = 'SVG'
            meta['notes'] = ['Native vector geometry preserved using the Flowrix converter. SVG viewport retained; pixel-grid and trim settings apply to raster tracing.']
            return {'code': code, 'shapes': len(native['shapes']), 'characters': len(code),
                    'compatible': True, 'grid': [512, 512], 'originalGrid': list(im.size),
                    'method': 'Native SVG geometry', 'rmse': round(math.sqrt(loss), 2),
                    'exactGrid': False, 'resized': False, 'source': png(target),
                    'target': png(target), 'result': png(out), 'types': native['stats']['types'], 'meta': meta}
        meta['notes'].append('Native SVG needs approximation: ' + ' '.join(native['warnings']) + ' Using complete-image tracing to retain the artwork.')
    result = convert(im, options)
    result['meta'] = meta
    return result


def prepare(im, grid=128, trim=True, background='#ffffff', alpha_mode='cutout', threshold=128, nearest=False):
    if trim and im.getbbox():
        im = im.crop(im.getbbox())
    size = (im.width, im.height)
    factor = min(1., grid / max(size))
    target = (max(1, round(size[0]*factor)), max(1, round(size[1]*factor)))
    if target != size:
        im = im.resize(target, Image.Resampling.NEAREST if nearest else Image.Resampling.LANCZOS)
    rgba = np.array(im)
    alpha = rgba[:,:,3:4].astype(float) / 255
    bg = np.array(tuple(bytes.fromhex(background[1:]))).reshape(1,1,3)
    rgb = np.rint(rgba[:,:,:3]*alpha + bg*(1-alpha)).astype(np.uint8)
    mask = (rgba[:,:,3] >= threshold) if alpha_mode == 'cutout' else np.ones(rgba.shape[:2],bool)
    if alpha_mode == 'cutout':
        # Preserve straight-alpha edge colour rather than baking white halos
        # into hair, lettering, and other fine silhouette details.
        rgb = rgba[:,:,:3].copy()
        rgb[~mask] = 0
    out = np.dstack((rgb, mask.astype(np.uint8)*255))
    return Image.fromarray(out), size, target


def rectangles(a):
    """Exact horizontal runs, coalesced vertically; never discard any pixel."""
    done, active = [], {}
    for y, row in enumerate(a):
        nxt = {}; x = 0
        while x < len(row):
            color = tuple(map(int,row[x]))
            end = x+1
            while end < len(row) and np.array_equal(row[end],row[x]): end += 1
            if color[3]:
                key = (x,end,color[:3])
                rect = active.pop(key, None)
                nxt[key] = (x, rect[1] if rect else y, end, y+1, color[:3])
            x = end
        done.extend(active.values()); active = nxt
    done.extend(active.values())
    return done


def draw_rects(rects, size):
    a = np.zeros((size[1],size[0],4),np.uint8)
    for x,y,r,b,c in rects: a[y:b,x:r] = (*c,255)
    return Image.fromarray(a)


def error(a,b):
    a = np.asarray(a,dtype=float); b=np.asarray(b,dtype=float)
    # Invisible RGB does not count. Alpha errors cost more than a colour error.
    a[:,:,:3] *= a[:,:,3:4]/255; b[:,:,:3] *= b[:,:,3:4]/255
    d=(a-b)**2; d[:,:,3]*=2
    return float(d.mean())


def adaptive(a,budget):
    """Best-error binary partitions using integral sums, weighted for silhouette."""
    f=a.astype(float); f[:,:,:3]*=f[:,:,3:4]/255
    h,w=a.shape[:2]
    integral=np.pad(f.cumsum(0).cumsum(1),((1,0),(1,0),(0,0)))
    squares=np.pad((f*f).cumsum(0).cumsum(1),((1,0),(1,0),(0,0)))
    def stats(box):
        x,y,r,b=box; n=(r-x)*(b-y)
        s=integral[b,r]-integral[y,r]-integral[b,x]+integral[y,x]
        q=squares[b,r]-squares[y,r]-squares[b,x]+squares[y,x]
        visible=s[3]/255
        if visible==0: return 0.,None
        color=np.clip(np.rint(s[:3]/visible),0,255)
        filled=float((q[:3]-2*color*s[:3]+n*color*color).sum()+2*(q[3]-510*s[3]+n*65025))
        blank=float(q[:3].sum()+2*q[3])
        if blank < filled: return blank,None
        return filled,tuple(map(int,color))
    def split(box):
        x,y,r,b=box; base,_=stats(box); best=None
        for axis,lo,hi in ((0,x,r),(1,y,b)):
            for at in range(lo+1,hi):
                pair=((x,y,at,b),(at,y,r,b)) if axis==0 else ((x,y,r,at),(x,at,r,b))
                e1,c1=stats(pair[0]); e2,c2=stats(pair[1]); gain=base-e1-e2
                if gain>0.01 and (best is None or gain>best[0]): best=(gain,pair)
        return best
    leaves={0:((0,0,w,h),stats((0,0,w,h))[1])}; heap=[]; serial=0; count=int(leaves[0][1] is not None)
    def offer(i):
        candidate=split(leaves[i][0])
        if candidate: heapq.heappush(heap,(-candidate[0],i,candidate[1]))
    offer(0)
    while heap and len(leaves)<1024:
        _,i,pair=heapq.heappop(heap)
        parent=leaves[i]; children=[(box,stats(box)[1]) for box in pair]
        cost=sum(c is not None for _,c in children)-int(parent[1] is not None)
        if count+cost>budget: continue
        del leaves[i]; count+=cost
        for child in children:
            serial+=1; leaves[serial]=child; offer(serial)
    return [(*box,c) for box,c in leaves.values() if c is not None]


def optimize(im,budget,style='auto'):
    a=np.array(im); exact=rectangles(a)
    if len(exact)<=budget: return exact,im,0.,'Exact grid'
    candidates=[]
    if style!='pixel':
        rects=adaptive(a,budget)
        out=draw_rects(rects,im.size); candidates.append((error(im,out),rects,out,'Adaptive detail'))
    if style=='detail': return _best(candidates)
    # Palette + run merging often beats geometric partitions on icons/pixel art.
    for grid in (1,2,4,6,8,12,16,24,32,48,64,96,128):
        factor=min(1,grid/max(im.size)); size=tuple(max(1,round(v*factor)) for v in im.size)
        small=im.resize(size,Image.Resampling.NEAREST if style=='pixel' else Image.Resampling.LANCZOS)
        for colors in (4,8,16,32):
            rgba=np.array(small); quant=small.convert('RGB').quantize(colors=colors,method=Image.Quantize.MEDIANCUT,dither=Image.Dither.NONE).convert('RGB')
            pix=np.dstack((np.array(quant),(rgba[:,:,3]>=128).astype(np.uint8)*255)); pix[pix[:,:,3]==0,:3]=0
            # Upsample before merging, so all candidates use the same coordinates.
            full=Image.fromarray(pix).resize(im.size,Image.Resampling.NEAREST)
            rects=rectangles(np.array(full))
            if len(rects)<=budget: candidates.append((error(im,full),rects,full,'Palette + merged pixels'))
    if not candidates: raise ValueError('No opaque pixels to convert. Lower the transparency threshold.')
    return _best(candidates)


def _best(candidates):
    e,rects,out,label=min(candidates,key=lambda c:(c[0],len(c[1])))
    return rects,out,e,label


def commands(rects,size,body_size=46):
    factor=body_size/max(size)
    def num(x): return f'{x:.8f}'.rstrip('0').rstrip('.') if x else '0'
    return '\n'.join(f'rect x={num(((x+r)/2-size[0]/2)*factor)} y={num(((y+b)/2-size[1]/2)*factor)} rx={num((r-x)*factor/2)} ry={num((b-y)*factor/2)} fill=#{c[0]:02x}{c[1]:02x}{c[2]:02x}' for x,y,r,b,c in rects)


def convert(im,options):
    im=im.convert('RGBA')
    mode=options.get('mode','game'); grid=max(8,min(512,int(options.get('grid',128))))
    budget=max(8,min(511,int(options.get('budget',511))))
    style=options.get('style','auto')
    background=options.get('background','#ffffff')
    if len(background)!=7 or background[0]!='#': raise ValueError('Invalid matte colour.')
    bytes.fromhex(background[1:])
    source=im.copy(); source.thumbnail((768,768))
    prepared,original,grid_size=prepare(im,grid,bool(options.get('trim',True)),background,options.get('alpha','cutout'),max(1,min(255,int(options.get('threshold',128)))),style=='pixel')
    if not np.any(np.array(prepared)[:,:,3]): raise ValueError('The selected frame is transparent at this threshold.')
    if style=='auto' and len(rectangles(np.array(prepared)))<=budget:
        mode='exact'
    if mode!='exact' and style in ('auto','vector'):
        try:
            loss,code,result,types,count=vector_shapes(prepared,budget,max(8,min(100,float(options.get('size',46)))))
        except ValueError:
            if style=='vector': raise
            style='detail'
        else:
            return {'code':code,'shapes':count,'characters':len(code),'compatible':count<=255,'grid':list(grid_size),'originalGrid':list(original),'method':'Layered contour tracing','rmse':round(math.sqrt(loss),2),'exactGrid':loss==0,'matchPercent':round(float(np.all(np.asarray(prepared)==np.asarray(result),axis=2).mean())*100,1),'resized':original!=grid_size,'source':png(source),'target':png(prepared),'result':png(result),'types':types}
    if mode=='exact':
        rects=rectangles(np.array(prepared)); result=prepared; loss=0.; method='Exact grid'
    else: rects,result,loss,method=optimize(prepared,budget,style)
    code=commands(rects,grid_size,max(8,min(100,float(options.get('size',46)))))
    return {'code':code,'shapes':len(rects),'characters':len(code),'compatible':len(rects)<=255,'grid':list(grid_size),'originalGrid':list(original),'method':method,'rmse':round(math.sqrt(loss),2),'exactGrid':loss==0,'matchPercent':round(float(np.all(np.asarray(prepared)==np.asarray(result),axis=2).mean())*100,1),'resized':original!=grid_size,'source':png(source),'target':png(prepared),'result':png(result)}


def vector_shapes(im,budget,body_size=46):
    """Trace whole color regions; preserve paths by splitting, never dropping them."""
    import subprocess
    import cv2
    from cairosvg import svg2png
    b=io.BytesIO();im.save(b,format='PNG')
    candidates=[]; root=Path(__file__).resolve().parent
    factor=body_size/max(im.size)
    for colors in (2,4,8,24,64,128,255):
        request={'png':base64.b64encode(b.getvalue()).decode(),'colors':colors,'simplify':0.6}
        process=subprocess.run(['node',str(root/'vectorize.js')],input=__import__('json').dumps(request),text=True,capture_output=True,timeout=35,cwd=root)
        if process.returncode: raise ValueError('The local vector tracer failed. Try a smaller pixel grid or Pixel art mode.')
        shapes=__import__('json').loads(process.stdout)['shapes']
        if len(shapes)>budget:
            # Reducing the palette does not guarantee monotonic region counts.
            continue
        markup=[];code=[];counts={}
        def num(n): return f'{n:.6f}'.rstrip('0').rstrip('.') if n else '0'
        for s in shapes:
            points=np.array(s['points'],dtype=np.float32);fill=s['fill'];kind='polygon';oval=None
            if len(points)>=5 and cv2.isContourConvex(points):
                ellipse=cv2.fitEllipse(points)
                (cx,cy),(dx,dy),rotation=ellipse
                area=abs(cv2.contourArea(points))
                # Smooth a nearly elliptical contour into one native ellipse.
                if dx>1 and dy>1 and abs(math.pi*dx*dy/4-area)<max(1,area*.09):
                    oval=(cx,cy,dx/2,dy/2,rotation);kind='ellipse'
            counts[kind]=counts.get(kind,0)+1
            if oval:
                cx,cy,rx,ry,rotation=oval
                markup.append(f'<ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" transform="rotate({rotation} {cx} {cy})" fill="{fill}"/>')
                code.append(f'ellipse x={num((cx-im.width/2)*factor)} y={num((cy-im.height/2)*factor)} rx={num(rx*factor)} ry={num(ry*factor)} rot={num(rotation)} fill={fill}')
            else:
                markup.append('<polygon points="'+' '.join(f'{x},{y}' for x,y in points)+'" fill="'+fill+'"/>')
                coords=','.join(num(v) for x,y in points for v in ((float(x)-im.width/2)*factor,(float(y)-im.height/2)*factor))
                code.append(f'polygon points={coords} fill={fill}')
        if not code: continue
        svg=f'<svg xmlns="http://www.w3.org/2000/svg" width="{im.width}" height="{im.height}" viewBox="0 0 {im.width} {im.height}">' + ''.join(markup)+'</svg>'
        out=Image.open(io.BytesIO(svg2png(bytestring=svg.encode(),output_width=im.width*2,output_height=im.height*2))).convert('RGBA').resize(im.size,Image.Resampling.LANCZOS)
        e=error(im,out)
        candidates.append((e,'\n'.join(code),out,counts,len(shapes)))
    if not candidates:
        # A small colour palette and stronger simplification is the bounded
        # fallback. Do not quietly return a picture with whole regions missing.
        raise ValueError('This picture needs more than the selected shape budget for outline tracing. Raise it to 511 or try Pixel art mode.')
    return min(candidates,key=lambda c:c[0])
