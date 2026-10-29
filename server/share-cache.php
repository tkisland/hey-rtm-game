<?php
declare(strict_types=1);
/** Private, bounded cache. Only existing server-issued result IDs can reach GD. */
function rs_cache_directory(): string {
    $config=rh_config_path();if(!$config)throw new RuntimeException('Share cache requires private configuration');
    $path=dirname($config).'/share-cache';
    if(!is_dir($path)&&!@mkdir($path,0700,true)&&!is_dir($path))throw new RuntimeException('Cannot create private share cache');
    $real=realpath($path);$root=realpath($_SERVER['DOCUMENT_ROOT'] ?? '');
    if(!$real||preg_match('~^/home/[^/]+/www(?:/|$)~',$real)||($root&&($real===$root||str_starts_with($real,$root.DIRECTORY_SEPARATOR))))throw new RuntimeException('Share cache must be outside document root');
    return $real;
}
/** Returns an open file, so another request may evict its path without breaking this response. */
function rs_cached_image(array $result) {
    $dir=rs_cache_directory();$path=$dir.'/'.hash('sha256',$result['id'].'|'.RS_ART).'.png';
    if($file=@fopen($path,'rb'))return $file;
    $lock=@fopen($dir.'/.generation.lock','c');if(!$lock)throw new RuntimeException('Cannot open share cache lock');
    try{
        $deadline=microtime(true)+2;
        while(!flock($lock,LOCK_EX|LOCK_NB)){if(microtime(true)>$deadline)rh_error(503,'share_busy','共有画像を準備中です。少し待って再試行してください。');usleep(20000);}
        if($file=@fopen($path,'rb'))return $file;
        $config=rh_config();$limit=max(1,min(300,(int)($config['share_generations_per_minute'] ?? 30)));
        $budgetPath=$dir.'/.generation.json';$budget=json_decode((string)@file_get_contents($budgetPath),true) ?? [];$bucket=(int)floor(time()/60);
        $used=($budget['bucket'] ?? -1)===$bucket?(int)($budget['used'] ?? 0):0;
        if($used>=$limit)rh_error(429,'share_rate_limit','共有画像の準備が混み合っています。1分ほど待って再試行してください。');
        if(@file_put_contents($budgetPath,json_encode(['bucket'=>$bucket,'used'=>$used+1],JSON_THROW_ON_ERROR))===false)throw new RuntimeException('Cannot update share budget');
        $bytes=rs_render_image($result);$maximum=max(1048576,min(1073741824,(int)($config['share_cache_max_bytes'] ?? 134217728)));
        if(strlen($bytes)>$maximum)throw new RuntimeException('Share image exceeds cache capacity');
        $files=[];$size=0;
        foreach(glob($dir.'/*.png') ?: [] as $old){$mtime=filemtime($old);$length=filesize($old);if($mtime<time()-30*86400){unlink($old);continue;}$files[]=['path'=>$old,'mtime'=>$mtime,'size'=>$length];$size+=$length;}
        usort($files,static fn($a,$b)=>$a['mtime']<=>$b['mtime']);
        foreach($files as $old){if($size+strlen($bytes)<=$maximum)break;unlink($old['path']);$size-=$old['size'];}
        foreach(glob($dir.'/tmp-*') ?: [] as $old)if(filemtime($old)<time()-600)unlink($old);
        $temporary=@tempnam($dir,'tmp-');if($temporary===false)throw new RuntimeException('Cannot create cached image');
        try{if(@file_put_contents($temporary,$bytes)!==strlen($bytes)||!@rename($temporary,$path))throw new RuntimeException('Cannot save cached image');}
        finally{if(is_file($temporary))unlink($temporary);}
        $file=fopen($path,'rb');if(!$file)throw new RuntimeException('Cannot read cached image');return $file;
    }finally{flock($lock,LOCK_UN);fclose($lock);}
}
function rs_render_image(array $result): string {
    if(!function_exists('imagettftext'))throw new RuntimeException('GD FreeType is required for share images');
    $source=@imagecreatefrompng(__DIR__.'/share/result-background.png');if(!$source)throw new RuntimeException('Share background is unavailable');$canvas=imagecreatetruecolor(1200,630);
    imagecopyresampled($canvas,$source,0,0,0,0,1200,630,imagesx($source),imagesy($source));imagedestroy($source);
    try{
        $font=__DIR__.'/share/DelaGothicOne-Regular.ttf';if(!is_readable($font))throw new RuntimeException('Share font is unavailable');
        $white=imagecolorallocate($canvas,255,250,255);$pink=imagecolorallocate($canvas,255,170,221);$gold=imagecolorallocate($canvas,255,232,128);
        $write=static function(string $text,int $size,int $y,int $color,int $width=950) use ($canvas,$font): void {
            do{$box=imagettfbbox($size,0,$font,$text);$w=$box[2]-$box[0];if($w<=$width||$size<=12)break;$size--;}while(true);
            imagettftext($canvas,$size,0,(int)((1200-$w)/2-$box[0]),$y,$color,$font,$text);
        };
        $write($result['message'],22,255,$pink);$write($result['title'].' / '.$result['level'],30,308,$white);
        $write('TOTAL',15,345,$pink);$write(number_format($result['score']),76,430,$gold);$write('MAX COMBO '.number_format($result['combo']),19,480,$white);
        ob_start();try{if(!imagepng($canvas,null,6))throw new RuntimeException('Cannot encode shared image');$bytes=ob_get_contents();}finally{ob_end_clean();}
        if(!is_string($bytes)||!str_starts_with($bytes,"\x89PNG\r\n\x1a\n"))throw new RuntimeException('Invalid shared PNG');return $bytes;
    }finally{imagedestroy($canvas);}
}
