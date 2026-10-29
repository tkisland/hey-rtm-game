<?php
declare(strict_types=1);
require __DIR__.'/share-common.php';
try {
    $result=rs_result($_GET);
    $file=$result['legacy']?fopen(__DIR__.'/ogp-v2.png','rb'):rs_cached_image($result);
    if(!$file)throw new RuntimeException('Shared image is unavailable');
    $etag='"'.hash('sha256',$result['legacy']?'common-ogp-v2':$result['id'].'|'.RS_ART).'"';
    header('Content-Type: image/png');header('X-Content-Type-Options: nosniff');header('Cache-Control: '.($result['legacy']?'public, max-age=86400':'public, max-age=0, must-revalidate'));header('ETag: '.$etag);
    if(($_SERVER['HTTP_IF_NONE_MATCH'] ?? '')===$etag){http_response_code(304);fclose($file);exit;}
    header('Content-Length: '.fstat($file)['size']);
    if(($_SERVER['REQUEST_METHOD'] ?? 'GET')!=='HEAD')fpassthru($file);fclose($file);
}catch(Throwable $error){rs_failure($error);}
