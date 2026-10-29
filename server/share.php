<?php
declare(strict_types=1);
require __DIR__.'/share-common.php';
try { $result=rs_result($_GET); } catch (Throwable $error) { rs_failure($error); }
$query=rs_query($result);$page=RS_SITE.'share.php?'.$query;$image=$result['legacy']?RS_SITE.'ogp-v2.png':RS_SITE.'share-image.php?'.$query;
$play='./game.html?'.http_build_query(['song'=>$result['song'],'difficulty'=>$result['difficulty']],'','&',PHP_QUERY_RFC3986);
$title=$result['title'].' / '.$result['level'].'｜HEY! RHYTHM!';
$description=$result['legacy']?$result['message']:$result['message'].' TOTAL '.number_format($result['score']).' / MAX COMBO '.number_format($result['combo']);
header('Content-Type: text/html; charset=utf-8');header('X-Content-Type-Options: nosniff');
header("Content-Security-Policy: default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'");
header('Referrer-Policy: no-referrer');header('Cache-Control: public, max-age=86400');
?>
<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title><?=rs_escape($title)?></title><meta name="robots" content="noindex,follow">
<link rel="canonical" href="<?=rs_escape($page)?>">
<meta property="og:type" content="website"><meta property="og:site_name" content="HEY! RHYTHM!">
<meta property="og:title" content="<?=rs_escape($title)?>"><meta property="og:description" content="<?=rs_escape($description)?>">
<meta property="og:url" content="<?=rs_escape($page)?>"><meta property="og:image" content="<?=rs_escape($image)?>">
<meta property="og:image:type" content="image/png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta property="og:image:alt" content="<?=rs_escape($description)?>"><meta property="og:locale" content="ja_JP">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="<?=rs_escape($title)?>">
<meta name="twitter:description" content="<?=rs_escape($description)?>"><meta name="twitter:image" content="<?=rs_escape($image)?>">
<meta name="twitter:image:alt" content="<?=rs_escape($description)?>">
<style>body{margin:0;background:#100b1b;color:#fff;font:16px system-ui,sans-serif;text-align:center}main{max-width:900px;margin:auto;padding:24px 16px}img{width:100%;height:auto;border-radius:12px}h1{font-size:24px}a{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:6px 20px;margin:8px;color:#fff;background:#a02879;border-radius:8px}p{line-height:1.6}.note{font-size:12px;color:#c9bcdb}</style>
</head><body><main><p>HEY! RHYTHM! · LIVE RESULT</p><h1><?=rs_escape($result['message'])?></h1>
<img src="<?=rs_escape($result['legacy']?'./ogp-v2.png':'./share-image.php?'.$query)?>" width="1200" height="630" alt="<?=rs_escape($description)?>">
<p><?=rs_escape($result['title'])?> / <?=rs_escape($result['level'])?><?php if(!$result['legacy']): ?><br>TOTAL <?=number_format($result['score'])?> · MAX COMBO <?=number_format($result['combo'])?><?php endif; ?></p>
<?php if($result['legacy']): ?><p class="note">以前の形式の共有リンクです。新しくプレイすると結果の画像を共有できます。</p><?php endif; ?>
<a href="<?=rs_escape($play)?>">この曲で遊ぶ</a><a href="./">曲を選ぶ</a>
<p class="note">Hey!Mommy!の曲でリズムゲーム！ · 非公式ファンメイド</p></main></body></html>
