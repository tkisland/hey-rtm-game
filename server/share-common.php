<?php
declare(strict_types=1);
require_once __DIR__.'/api/core.php';
const RS_SITE='https://hey.jpn.org/rhythm/';
function rs_message(int $base): string {
    return match(true) {
        $base>=1000000=>'伝説のLIVE！', $base>=950000=>'最高なLIVE！',
        $base>=850000=>'大盛り上がりのLIVE！', $base>=700000=>'いい感じのLIVE！',
        $base>=500000=>'レスが届いたLIVE！', default=>'また一緒にLIVEしよう！',
    };
}
function rs_result(array $query): array {
    $catalog=rh_catalog();$song=$query['song'] ?? '';$difficulty=$query['difficulty'] ?? '';
    if (!is_string($song) || !isset($catalog['songs'][$song]) || !in_array($difficulty,['easy','normal','hard'],true)) rh_error(400,'invalid_share','共有する曲を確認してください。');
    $query['art'] ??='2'; // Old links remain valid; new artwork gets a separate card-cache URL.
    $result=['song'=>$song,'difficulty'=>$difficulty];
    foreach (['v'=>[4,4],'art'=>[2,2],'score'=>[0,2147483647],'base'=>[0,1000000],'combo'=>[0,5000],'skipped'=>[0,5000]] as $name=>[$min,$max]) {
        $value=$query[$name] ?? null;
        if (!is_string($value) || !preg_match('/^(0|[1-9][0-9]{0,9})$/D',$value) || (int)$value<$min || (int)$value>$max) rh_error(400,'invalid_share','共有する結果を確認してください。');
        $result[$name]=(int)$value;
    }
    if ($result['base']>$result['score']) rh_error(400,'invalid_share','共有する結果を確認してください。');
    return $result+['title'=>$catalog['songs'][$song]['title'],'level'=>['easy'=>'かんたん','normal'=>'ふつう','hard'=>'むずかしい'][$difficulty],'message'=>rs_message($result['base'])];
}
function rs_query(array $result): string {
    return http_build_query(array_intersect_key($result,array_flip(['song','difficulty','v','art','score','base','combo','skipped'])),'','&',PHP_QUERY_RFC3986);
}
function rs_escape(string $value): string { return htmlspecialchars($value,ENT_QUOTES|ENT_SUBSTITUTE,'UTF-8'); }
function rs_failure(Throwable $error): never {
    http_response_code($error instanceof RankingError ? $error->httpStatus : 503);
    header('Content-Type: text/plain; charset=utf-8');header('Cache-Control: no-store');
    echo $error instanceof RankingError ? $error->getMessage() : '共有ページを利用できません。';exit;
}
