<?php
declare(strict_types=1);
require_once __DIR__.'/api/core.php';
const RS_SITE='https://hey.jpn.org/rhythm/';
const RS_ART=4;
function rs_message(int $base): string {
    return match(true) {
        $base>=1000000=>'伝説のLIVE！', $base>=950000=>'最高なLIVE！',
        $base>=850000=>'大盛り上がりのLIVE！', $base>=700000=>'いい感じのLIVE！',
        $base>=500000=>'レスが届いたLIVE！', default=>'また一緒にLIVEしよう！',
    };
}
function rs_result(array $query,?PDO $db=null): array {
    if(array_key_exists('id',$query)){
        $id=$query['id'];$art=$query['art'] ?? (string)RS_ART;
        if(!is_string($id)||!preg_match('/^[a-f0-9]{32}$/D',$id)||$art!==(string)RS_ART)rh_error(400,'invalid_share','共有リンクを確認してください。');
        if(!$db){$config=rh_config();if(!$config)rh_error(503,'share_unavailable','共有結果を取得できません。');$db=rh_db($config);}
        $q=$db->prepare('SELECT id,token_hash,song_id,difficulty,title,rules_version,score,base_score,max_combo FROM rhythm_shared_results WHERE id=?');$q->execute([$id]);$row=$q->fetch();
        if($row && rh_is_hidden($db,$row['token_hash']))rh_error(404,'share_not_found','共有結果が見つかりません。');
        if(!$row)rh_error(404,'share_not_found','共有結果が見つかりません。');
        $result=['id'=>$id,'art'=>RS_ART,'legacy'=>false,'song'=>$row['song_id'],'difficulty'=>$row['difficulty'],'title'=>$row['title'],'v'=>(int)$row['rules_version'],'score'=>(int)$row['score'],'base'=>(int)$row['base_score'],'combo'=>(int)$row['max_combo'],'skipped'=>0];
        return $result+['level'=>['easy'=>'かんたん','normal'=>'ふつう','hard'=>'むずかしい'][$result['difficulty']],'message'=>rs_message($result['base'])];
    }
    // Old numeric URLs remain navigable but never produce a claimed result image.
    $catalog=rh_catalog();$song=$query['song'] ?? '';$difficulty=$query['difficulty'] ?? '';
    if(!is_string($song)||!isset($catalog['songs'][$song])||!in_array($difficulty,['easy','normal','hard'],true))rh_error(400,'invalid_share','共有する曲を確認してください。');
    return ['legacy'=>true,'song'=>$song,'difficulty'=>$difficulty,'title'=>$catalog['songs'][$song]['title'],'level'=>['easy'=>'かんたん','normal'=>'ふつう','hard'=>'むずかしい'][$difficulty],'message'=>'Hey!Mommy!の曲でリズムゲーム！'];
}
function rs_query(array $result): string {
    return http_build_query($result['legacy']?['song'=>$result['song'],'difficulty'=>$result['difficulty']]:['id'=>$result['id'],'art'=>RS_ART],'','&',PHP_QUERY_RFC3986);
}
function rs_escape(string $value): string { return htmlspecialchars($value,ENT_QUOTES|ENT_SUBSTITUTE,'UTF-8'); }
function rs_failure(Throwable $error): never {
    http_response_code($error instanceof RankingError ? $error->httpStatus : 503);
    header('Content-Type: text/plain; charset=utf-8');header('Cache-Control: no-store');header('Retry-After: 60');
    if(!($error instanceof RankingError))error_log('Rhythm share: '.$error->getMessage());
    echo $error instanceof RankingError ? $error->getMessage() : '共有画像を準備できません。少し待って再試行してください。';exit;
}
require_once __DIR__.'/share-cache.php';
