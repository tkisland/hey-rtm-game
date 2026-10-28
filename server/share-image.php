<?php
declare(strict_types=1);
require __DIR__.'/share-common.php';
try {
    $result=rs_result($_GET);
    if (!function_exists('imagettftext')) throw new RuntimeException('GD FreeType is required for share images');
    $source=imagecreatefrompng(__DIR__.'/share/result-background.png');$canvas=imagecreatetruecolor(1200,630);
    imagecopyresampled($canvas,$source,0,0,0,0,1200,630,imagesx($source),imagesy($source));imagedestroy($source);
    $font=__DIR__.'/share/DelaGothicOne-Regular.ttf';
    $white=imagecolorallocate($canvas,255,250,255);$pink=imagecolorallocate($canvas,255,170,221);$gold=imagecolorallocate($canvas,255,232,128);
    $write=static function(string $text,int $size,int $y,int $color,int $width=950) use ($canvas,$font): void {
        do { $box=imagettfbbox($size,0,$font,$text);$w=$box[2]-$box[0];if($w<=$width || $size<=12)break;$size--; } while(true);
        imagettftext($canvas,$size,0,(int)((1200-$w)/2-$box[0]),$y,$color,$font,$text);
    };
    $write($result['message'],22,255,$pink);
    $write($result['title'].' / '.$result['level'],30,308,$white);
    $write('TOTAL',15,345,$pink);
    $write(number_format($result['score']),76,430,$gold);
    $write('基本スコア '.number_format($result['base']).' / MAX COMBO '.number_format($result['combo']),19,480,$white);
    if($result['skipped']>0)$write('シークでスキップ '.number_format($result['skipped']).'ノーツ',12,505,$pink);
    header('Content-Type: image/png');header('X-Content-Type-Options: nosniff');header('Cache-Control: public, max-age=86400');
    imagepng($canvas,null,6);imagedestroy($canvas);
} catch (Throwable $error) { rs_failure($error); }
