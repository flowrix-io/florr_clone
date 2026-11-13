import io
import re
import unittest
import numpy as np
from PIL import Image
from converter import decode, convert, rectangles, draw_rects

class ConversionTests(unittest.TestCase):
    def test_polygon_selection_overrides_exact_pixel_mode(self):
        result=convert(self.fixture(),{'mode':'exact','style':'polygon','budget':1000})
        self.assertTrue(all(line.startswith('polygon ') for line in result['code'].splitlines()))
        self.assertGreater(result['shapes'],0)
    def test_auto_never_silently_switches_to_rectangles(self):
        from unittest.mock import patch
        with patch('converter.vector_shapes',side_effect=ValueError('Tracing failed')):
            with self.assertRaisesRegex(ValueError,'did not switch to rectangles'):
                convert(self.fixture(),{'style':'auto'})
    def test_background_removal_keeps_enclosed_matching_details(self):
        from converter import remove_background
        a=np.full((24,24,4),255,np.uint8)
        a[5:19,5:19]=[200,30,40,255]
        a[10:14,10:14]=[255,255,255,255]
        out=np.array(remove_background(Image.fromarray(a),10))
        self.assertEqual(out[0,0,3],0)
        self.assertEqual(out[7,7,3],255)
        self.assertEqual(out[11,11,3],255)
    def test_background_removal_retains_existing_transparency(self):
        from converter import remove_background
        im=self.fixture()
        self.assertTrue(np.array_equal(np.array(im),np.array(remove_background(im))))
    def test_background_removal_applies_to_svg_and_returns_cutout(self):
        from converter import convert_file
        data=b'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="white"/><circle cx="12" cy="12" r="6" fill="red"/></svg>'
        result=convert_file(data,'test.svg',options={'removeBackground':True,'style':'polygon','budget':64})
        out=Image.open(io.BytesIO(__import__('base64').b64decode(result['cutout'].split(',')[1])))
        self.assertEqual(out.getpixel((0,0))[3],0)
        self.assertEqual(out.getpixel((12,12))[3],255)
        self.assertNotEqual(result['method'],'Native SVG geometry')
    def test_vector_preview_uses_exported_geometry_at_display_resolution(self):
        import base64
        from defusedxml import ElementTree
        result=convert(self.fixture(),{'style':'polygon','grid':32,'budget':255})
        svg=base64.b64decode(result['previewSvg'].split(',')[1])
        root=ElementTree.fromstring(svg)
        self.assertEqual(len(root),result['shapes'])
        self.assertTrue(all(e.tag.endswith('polygon') for e in root))
        hi=Image.open(io.BytesIO(base64.b64decode(result['previewPng'].split(',')[1])))
        self.assertGreater(hi.width,result['grid'][0])
    def test_palette_limit_and_contour_detail_stay_within_budget(self):
        result=convert(self.fixture(),{'style':'polygon','budget':64,'maxColors':2,'detail':.2})
        colors={line.split('fill=')[1].split()[0] for line in result['code'].splitlines()}
        self.assertLessEqual(len(colors),2)
        self.assertLessEqual(result['shapes'],64)
    def test_small_coloured_details_survive_tracing(self):
        im=Image.new('RGBA',(16,16),'red')
        im.putpixel((8,8),(0,0,255,255))
        result=convert(im,{'style':'polygon','budget':128,'trim':False,'maxColors':8})
        self.assertIn('fill=#0000ff',result['code'])
    def test_colour_noise_is_reduced_without_shrinking_outline_grid(self):
        from PIL import ImageDraw
        im=Image.new('RGB',(128,128),(30,120,40))
        ImageDraw.Draw(im).ellipse((20,20,108,108),fill=(245,200,20))
        a=np.array(im).astype(np.int16)
        a=np.clip(a+np.random.default_rng(8).integers(-4,5,a.shape),0,255).astype(np.uint8)
        result=convert(Image.fromarray(a),{'style':'polygon','grid':128,'budget':128,'trim':False})
        self.assertEqual(result['traceGrid'],[128,128])
        self.assertLessEqual(result['shapes'],128)
    def fixture(self):
        a=np.zeros((16,24,4),np.uint8)
        a[2:14,4:20]=[255,220,80,255]; a[6:9,8:10]=[30,50,40,255]
        a[6:9,15:17]=[30,50,40,255]
        return Image.fromarray(a)
    def test_exact_run_merge_preserves_every_pixel(self):
        im=self.fixture();rects=rectangles(np.array(im))
        self.assertLess(len(rects),10)
        self.assertTrue(np.array_equal(np.array(im),np.array(draw_rects(rects,im.size))))
    def test_commands_reconstruct_grid_in_skin_coordinates(self):
        result=convert(self.fixture(),{'mode':'exact','trim':False})
        a=np.zeros((16,24,4),np.uint8);factor=46/24
        for line in result['code'].splitlines():
            self.assertTrue(line.startswith('rect '))
            fields=dict(word.split('=') for word in line.split()[1:])
            x,y,rx,ry=(float(fields[k]) for k in ('x','y','rx','ry'))
            x0=round((x-rx)/factor+12);x1=round((x+rx)/factor+12)
            y0=round((y-ry)/factor+8);y1=round((y+ry)/factor+8)
            a[y0:y1,x0:x1]=(*bytes.fromhex(fields['fill'][1:]),255)
            self.assertLessEqual(max(abs(x),abs(y),rx,ry),64)
        self.assertTrue(np.array_equal(a,np.array(self.fixture())))
    def test_pixel_style_preserves_exact_grid_when_it_fits(self):
        result=convert(self.fixture(),{'grid':128,'style':'pixel'})
        self.assertTrue(result['compatible']);self.assertTrue(result['exactGrid'])
    def test_photo_never_exceeds_budget_and_preview_matches_shapes(self):
        rng=np.random.default_rng(42)
        im=Image.fromarray(np.dstack((rng.integers(0,256,(32,32,3),dtype=np.uint8),np.full((32,32),255,np.uint8))))
        for style in ('auto','polygon','detail','pixel'):
            result=convert(im,{'budget':32,'style':style,'trim':False})
            self.assertLessEqual(result['shapes'],32)
            self.assertEqual(len(result['code'].splitlines()),result['shapes'])
            if style=='polygon':
                self.assertTrue(all(line.startswith('polygon ') for line in result['code'].splitlines()))
    def test_exact_over_budget_is_marked_incompatible(self):
        a=np.zeros((32,32,4),np.uint8);a[:,:,3]=255
        for y in range(32):
            for x in range(32):a[y,x,:3]=[x*7,y*7,(x+y)*3]
        result=convert(Image.fromarray(a),{'mode':'exact'})
        self.assertFalse(result['compatible']);self.assertTrue(result['exactGrid'])
        self.assertEqual(result['shapes'],1024)
    def test_alpha_cutout_and_matte_are_explicit(self):
        im=Image.new('RGBA',(4,4),(255,0,0,64))
        with self.assertRaises(ValueError):convert(im,{})
        result=convert(im,{'alpha':'matte','background':'#ffffff'})
        self.assertIn('#ffbfbf',result['code'])
    def test_transparent_image_rejected(self):
        with self.assertRaises(ValueError):convert(Image.new('RGBA',(8,8)),{})
    def test_common_and_extended_decoders(self):
        formats=['PNG','JPEG','WEBP','TIFF','BMP','GIF','ICO','PPM','TGA','AVIF','HEIF','JPEG2000']
        for fmt in formats:
            with self.subTest(format=fmt):
                im=self.fixture().resize((32,32)).convert('RGB')
                b=io.BytesIO();im.save(b,format=fmt)
                decoded,meta=decode(b.getvalue(),'art.'+fmt.lower())
                self.assertEqual(decoded.size,(32,32))
    def test_animation_selects_requested_frame(self):
        b=io.BytesIO();Image.new('RGB',(4,4),'red').save(b,format='GIF',save_all=True,append_images=[Image.new('RGB',(4,4),'blue')],duration=100,loop=0)
        im,meta=decode(b.getvalue(),'test.gif',1)
        self.assertEqual(meta['frames'],2);self.assertEqual(im.getpixel((0,0)),(0,0,255,255))
    def test_svg_aspect_ratio_and_no_external_fetch(self):
        data=b'<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="red"/></svg>'
        im,_=decode(data,'test.svg');self.assertEqual(im.size,(40,20))
        data=b'<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><image href="https://example.com/a.png" width="20" height="20"/></svg>'
        with self.assertRaises(ValueError):decode(data,'test.svg')
    def test_exif_orientation(self):
        im=Image.new('RGB',(6,10));e=im.getexif();e[274]=6
        b=io.BytesIO();im.save(b,format='JPEG',exif=e)
        decoded,_=decode(b.getvalue(),'rotated.jpg');self.assertEqual(decoded.size,(10,6))
    def test_invalid_file_rejected(self):
        with self.assertRaises(ValueError):decode(b'not an image','picture.png')
    def test_resize_reported(self):
        result=convert(Image.new('RGB',(300,100),'red'),{'grid':128,'mode':'exact'})
        self.assertTrue(result['resized']);self.assertEqual(result['grid'],[128,43])

if __name__=='__main__':unittest.main()

class VectorTests(unittest.TestCase):
    def test_contour_mode_uses_outlines_not_pixel_rectangles(self):
        from PIL import ImageDraw
        im=Image.new('RGBA',(96,96));d=ImageDraw.Draw(im)
        d.ellipse((8,8,88,88),fill='#e66452');d.ellipse((30,30,45,60),fill='#ffffff')
        result=convert(im,{'style':'vector','budget':255,'grid':128,'trim':False})
        self.assertEqual(result['method'],'Adaptive contour tracing (detail fitted to budget)')
        self.assertNotIn('rect ',result['code'])
        self.assertLess(result['shapes'],30)
        for line in result['code'].splitlines():
            if line.startswith('polygon '):
                points=line.split('points=')[1].split()[0].split(',')
                self.assertLessEqual(len(points),32)
    def test_transparent_donut_keeps_its_hole(self):
        from PIL import ImageDraw
        im=Image.new('RGBA',(64,64));d=ImageDraw.Draw(im)
        d.ellipse((5,5,58,58),fill='#2e78d4');d.ellipse((22,22,41,41),fill=(0,0,0,0))
        result=convert(im,{'style':'vector','budget':255,'trim':False})
        preview=Image.open(io.BytesIO(__import__('base64').b64decode(result['result'].split(',')[1])))
        self.assertLess(preview.getpixel((32,32))[3],10)

class EdgeColorTests(unittest.TestCase):
    def test_cutout_does_not_add_white_halos(self):
        im=Image.new('RGBA',(8,8),(20,180,170,160))
        result=convert(im,{'mode':'exact'})
        self.assertIn('#14b4aa',result['code'])

class NativeSvgTests(unittest.TestCase):
    def test_1000_target_preserves_700_native_shapes(self):
        import base64
        from server import convert_request
        shapes=''.join(f'<circle cx="{x*3+2}" cy="{y*3+2}" r="1"/>' for y in range(20) for x in range(35))
        svg=('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 107 62">'+shapes+'</svg>').encode()
        result=convert_request({'image':base64.b64encode(svg).decode(),'name':'many.svg','options':{'gameLimit':1000,'budget':1000}})
        self.assertEqual(result['shapes'],700)
        self.assertTrue(result['compatible'])
        self.assertFalse(result['gameCompatible'])

    def test_polygon_look_emits_polygons_for_raster(self):
        from PIL import ImageDraw
        im=Image.new('RGBA',(48,48));d=ImageDraw.Draw(im)
        d.polygon([(3,40),(24,3),(44,40)],fill='#ff4400')
        result=convert(im,{'style':'polygon','budget':1000,'grid':64})
        self.assertTrue(result['code'].startswith('polygon '))
        self.assertNotIn('rect ',result['code'])

    def test_high_detail_target_preserves_more_than_255_vectors(self):
        import base64
        from server import convert_request
        shapes=''.join(f'<circle cx="{x*3+2}" cy="{y*3+2}" r="1" fill="#e06040"/>' for y in range(10) for x in range(30))
        svg=('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 92 32">'+shapes+'</svg>').encode()
        result=convert_request({'image':base64.b64encode(svg).decode(),'name':'detail.svg','options':{'gameLimit':511,'budget':511}})
        self.assertEqual(result['method'],'Native SVG geometry')
        self.assertEqual(result['shapes'],300)
        self.assertTrue(result['compatible'])
        self.assertFalse(result['gameCompatible'])

    def test_flowrix_target_rejects_exact_export_over_128_shapes(self):
        import base64
        from server import convert_request
        im=Image.new('RGB',(16,16))
        im.putdata([(255,0,0) if (x+y)%2 else (0,0,255) for y in range(16) for x in range(16)])
        b=io.BytesIO();im.save(b,format='PNG')
        request={'image':base64.b64encode(b.getvalue()).decode(),'name':'check.png',
                 'options':{'gameLimit':128,'mode':'exact','style':'pixel'}}
        result=convert_request(request)
        self.assertEqual(result['shapes'],256)
        self.assertFalse(result['compatible'])
        request['options']['mode']='game'
        result=convert_request(request)
        self.assertLessEqual(result['shapes'],128)
        self.assertTrue(result['compatible'])

    def test_compressed_svg_keeps_native_geometry(self):
        import gzip
        from converter import convert_file
        data=gzip.compress(b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8"/></svg>')
        result=convert_file(data,'art.svgz')
        self.assertEqual(result['method'],'Native SVG geometry')
        self.assertEqual(result['shapes'],1)

    def test_svg_retains_native_circle_and_curve(self):
        from converter import convert_file
        svg=b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="#ff0000"/><path d="M20 50 C30 20 70 20 80 50" fill="none" stroke="#ffffff" stroke-width="3"/></svg>'
        result=convert_file(svg,'art.svg')
        self.assertEqual(result['method'],'Native SVG geometry')
        self.assertIn('circle ',result['code'])
        self.assertIn('curve ',result['code'])
        self.assertEqual(result['shapes'],2)
        self.assertLess(result['rmse'],8)

    def test_svg_external_image_is_rejected_before_native_conversion(self):
        from converter import convert_file
        svg=b'<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><image href="file:///etc/passwd" width="20" height="20"/></svg>'
        with self.assertRaises(ValueError):convert_file(svg,'bad.svg')

    def test_raster_files_still_use_complete_pixel_mode(self):
        from converter import convert_file
        b=io.BytesIO();Image.new('RGB',(20,10),'red').save(b,format='PNG')
        result=convert_file(b.getvalue(),'art.png',options={'mode':'exact'})
        self.assertEqual(result['method'],'Exact grid')
        self.assertEqual(result['shapes'],1)
