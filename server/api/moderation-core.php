<?php
declare(strict_types=1);
require_once __DIR__.'/core.php';
/** Fixed HTTPS destinations only; ID tokens are never accepted from a URL or logged. */
function rm_http(string $url,?array $body=null,?string $token=null): array {
    $headers=['Accept: application/json'];if($body!==null)$headers[]='Content-Type: application/json';if($token!==null)$headers[]='Authorization: Bearer '.$token;
    $context=stream_context_create(['http'=>['method'=>$body===null?'GET':'POST','header'=>implode("\r\n",$headers),'content'=>$body===null?'':json_encode($body,JSON_THROW_ON_ERROR),'timeout'=>6,'follow_location'=>0,'ignore_errors'=>true],'ssl'=>['verify_peer'=>true,'verify_peer_name'=>true]]);
    $text=@file_get_contents($url,false,$context,0,65537);$status=0;
    if(preg_match('~^HTTP/\S+ (\d{3})~',$http_response_header[0] ?? '',$m))$status=(int)$m[1];
    if($text===false||strlen($text)>65536)rh_error(503,'admin_verification','管理者権限を確認できません。接続を確認して再試行してください。');
    try{$json=json_decode($text,true,32,JSON_THROW_ON_ERROR);}catch(JsonException){rh_error(503,'admin_verification','管理者権限を確認できません。');}
    return [$status,is_array($json)?$json:[]];
}
/** The optional transport is for isolated tests; HTTP callers cannot override it. */
function rm_require_admin(array $catalog,string $token,?callable $transport=null): string {
    $project=$catalog['firebase']['projectId'] ?? '';$key=$catalog['firebase']['apiKey'] ?? '';
    if(!$project||!$key)rh_error(503,'admin_setup','Firebaseの管理者認証を準備中です。');
    if(strlen($token)>8192||!preg_match('/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/D',$token))rh_error(401,'admin_login','Googleで管理者ログインしてください。');
    $parts=explode('.',$token);
    try{
        $decode=static function(string $value):array{$text=base64_decode(strtr($value,'-_','+/'),true);if($text===false)throw new RuntimeException();$json=json_decode($text,true,16,JSON_THROW_ON_ERROR);if(!is_array($json))throw new RuntimeException();return $json;};
        $header=$decode($parts[0]);$claims=$decode($parts[1]);
    }catch(Throwable){rh_error(401,'admin_login','Googleで管理者ログインしてください。');}
    if(($header['alg'] ?? '')!=='RS256'||!is_string($header['kid'] ?? null)||!is_int($claims['exp'] ?? null)||$claims['exp']<=time()
        ||!is_int($claims['iat'] ?? null)||$claims['iat']>time()+60||!is_int($claims['auth_time'] ?? null)||$claims['auth_time']>time()+60
        ||($claims['iss'] ?? '')!=='https://securetoken.google.com/'.$project||($claims['aud'] ?? '')!==$project
        ||($claims['email_verified'] ?? false)!==true||($claims['firebase']['sign_in_provider'] ?? '')!=='google.com'
        ||!is_string($claims['sub'] ?? null)||!preg_match('/^[A-Za-z0-9_-]{1,128}$/D',$claims['sub']))rh_error(401,'admin_login','管理者としてGoogleログインし直してください。');
    // The decoded claims above only reject invalid shapes. Google verifies the actual ID token.
    $request=$transport ?? 'rm_http';
    [$status,$identity]=$request('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key='.rawurlencode($key),['idToken'=>$token],null);
    if(in_array($status,[400,401,403],true))rh_error(401,'admin_login','管理者としてGoogleログインし直してください。');
    if($status!==200)rh_error(503,'admin_verification','Googleの認証を確認できません。');
    $user=$identity['users'][0] ?? null;
    if(!is_array($user)||($user['localId'] ?? '')!==$claims['sub']||($user['emailVerified'] ?? false)!==true||($user['disabled'] ?? false)
        ||$claims['auth_time']<(int)($user['validSince'] ?? 0))rh_error(401,'admin_login','管理者としてGoogleログインし直してください。');
    $uid=$user['localId'];
    [$status,$role]=$request('https://firestore.googleapis.com/v1/projects/'.rawurlencode($project).'/databases/(default)/documents/admins/'.rawurlencode($uid).'?key='.rawurlencode($key),null,$token);
    if(in_array($status,[401,403,404],true)||$status===200&&($role['fields']['enabled']['booleanValue'] ?? false)!==true)rh_error(403,'admin_denied','このアカウントには管理者権限がありません。');
    if($status!==200)rh_error(503,'admin_verification','管理者権限を確認できません。');
    return $uid;
}
function rm_ready(PDO $db): bool {return rh_has_visibility($db)&&(bool)$db->query("SHOW TABLES LIKE 'rhythm_moderation_log'")->fetchColumn();}
function rm_id(mixed $id): string {
    if(!is_string($id)||!preg_match('/^[1-9][0-9]{0,19}$/D',$id)||strlen($id)===20&&strcmp($id,'18446744073709551615')>0)rh_error(400,'invalid_entry','記録IDを確認してください。');return $id;
}
function rm_list(PDO $db,array $catalog,array $data): array {
    $song=$data['songId'] ?? '';$difficulty=$data['difficulty'] ?? '';
    if(!is_string($song)||!isset($catalog['songs'][$song])||!in_array($difficulty,['easy','normal','hard'],true))rh_error(400,'invalid_board','曲と難易度を確認してください。');
    $cursor=isset($data['cursor'])?rm_id($data['cursor']):null;
    $q=$db->prepare('SELECT e.id,e.name,e.score,e.max_combo,e.created_at,b.rules_version,b.chart_hash,COALESCE(v.hidden,0) AS hidden,COALESCE(v.revision,0) AS revision,v.reason,v.actor_uid,v.updated_at FROM rhythm_entries e JOIN rhythm_boards b ON b.id=e.board_id LEFT JOIN rhythm_entry_visibility v ON v.entry_id=e.id WHERE b.song_id=? AND b.difficulty=?'.($cursor?' AND e.id<?':'').' ORDER BY e.id DESC LIMIT 51');
    $q->execute($cursor?[$song,$difficulty,$cursor]:[$song,$difficulty]);$rows=$q->fetchAll();$more=count($rows)>50;$rows=array_slice($rows,0,50);
    $entries=array_map(static fn($row)=>rh_entry($row)+['rulesVersion'=>(int)$row['rules_version'],'chartHash'=>$row['chart_hash'],'hidden'=>(bool)$row['hidden'],'revision'=>(int)$row['revision'],'reason'=>$row['reason'] ?? '','actorUid'=>$row['actor_uid'] ?? '','updatedAt'=>(int)($row['updated_at'] ?? 0)],$rows);
    return ['entries'=>$entries,'nextCursor'=>$more?(string)$rows[count($rows)-1]['id']:null];
}
function rm_history(PDO $db,array $data): array {
    $id=rm_id($data['entryId'] ?? null);$q=$db->prepare('SELECT hidden,revision,reason,actor_uid,created_at FROM rhythm_moderation_log WHERE entry_id=? ORDER BY id DESC LIMIT 20');$q->execute([$id]);
    return ['history'=>array_map(static fn($r)=>['hidden'=>(bool)$r['hidden'],'revision'=>(int)$r['revision'],'reason'=>$r['reason'],'actorUid'=>$r['actor_uid'],'createdAt'=>(int)$r['created_at']],$q->fetchAll())];
}
function rm_change(PDO $db,string $uid,array $data,bool $hidden): array {
    $id=rm_id($data['entryId'] ?? null);$revision=$data['revision'] ?? null;$reason=$data['reason'] ?? null;
    if(!is_int($revision)||$revision<0||$revision>2147483646||!is_string($reason))rh_error(422,'invalid_reason','変更理由を1〜200文字で入力してください。');
    $reason=trim(preg_replace('/^\p{Z}+|\p{Z}+$/u','',$reason) ?? '');
    if(!preg_match('/^[^\p{C}]{1,200}$/uD',$reason))rh_error(422,'invalid_reason','変更理由を1〜200文字で入力してください。');
    $db->beginTransaction();
    try{
        $q=$db->prepare('SELECT id FROM rhythm_entries WHERE id=? FOR UPDATE');$q->execute([$id]);if(!$q->fetch())rh_error(404,'entry_missing','記録が見つかりません。');
        $q=$db->prepare('SELECT * FROM rhythm_entry_visibility WHERE entry_id=?');$q->execute([$id]);$old=$q->fetch();$current=(int)($old['revision'] ?? 0);
        if($revision!==$current){
            if($current!==$revision+1||!$old||(bool)$old['hidden']!==$hidden||$old['actor_uid']!==$uid||$old['reason']!==$reason)rh_error(409,'moderation_conflict','別の操作で記録が更新されました。一覧を読み込み直してください。');
        }elseif((bool)($old['hidden'] ?? false)!==$hidden){
            $current++;$now=time();
            $q=$db->prepare('INSERT INTO rhythm_entry_visibility (entry_id,hidden,revision,reason,actor_uid,updated_at) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE hidden=VALUES(hidden),revision=VALUES(revision),reason=VALUES(reason),actor_uid=VALUES(actor_uid),updated_at=VALUES(updated_at)');$q->execute([$id,(int)$hidden,$current,$reason,$uid,$now]);
            $q=$db->prepare('INSERT INTO rhythm_moderation_log (entry_id,hidden,revision,reason,actor_uid,created_at) VALUES (?,?,?,?,?,?)');$q->execute([$id,(int)$hidden,$current,$reason,$uid,$now]);
        }
        $db->commit();return ['entryId'=>$id,'hidden'=>$hidden,'revision'=>$current];
    }catch(Throwable $error){if($db->inTransaction())$db->rollBack();throw $error;}
}
