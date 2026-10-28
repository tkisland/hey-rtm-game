<?php
declare(strict_types=1);

const RH_SCORE_RULES_VERSION = 4;

final class RankingError extends RuntimeException {
    public function __construct(public int $httpStatus, public string $errorCode, string $message) { parent::__construct($message); }
}
function rh_error(int $status, string $code, string $message): never { throw new RankingError($status,$code,$message); }
function rh_config(): ?array {
    $home=getenv('HOME') ?: '';
    if (preg_match('~^(/home/[^/]+)/~',__DIR__,$match)) $home=$match[1];
    $path=getenv('RHYTHM_CONFIG_PATH') ?: ($home ? $home.'/rhythm-private/config.php' : '');
    if (!$path || !is_file($path)) return null;
    $real=realpath($path);$root=realpath($_SERVER['DOCUMENT_ROOT'] ?? '');
    if (!$real || preg_match('~^/home/[^/]+/www(?:/|$)~',$real) || ($root && ($real===$root || str_starts_with($real,$root.DIRECTORY_SEPARATOR)))) return null;
    $config=require $real;
    if (!is_array($config)) return null;
    foreach (['db_host','db_name','db_user','db_password'] as $key) if (!is_string($config[$key] ?? null) || $config[$key]==='') return null;
    return $config;
}
function rh_db(array $config): PDO {
    if (!preg_match('/^[a-zA-Z0-9_.-]+$/D',$config['db_host']) || !preg_match('/^[a-zA-Z0-9_]+$/D',$config['db_name'])) throw new RuntimeException('Invalid database configuration');
    $db=new PDO('mysql:host='.$config['db_host'].';dbname='.$config['db_name'].';charset=utf8mb4',$config['db_user'],$config['db_password'],[
        PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_EMULATE_PREPARES=>false,
        PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC,PDO::ATTR_TIMEOUT=>5,
    ]);
    if ((int)$db->query('SELECT version FROM rhythm_schema WHERE id=1')->fetchColumn()!==1) throw new RuntimeException('Unsupported database schema');
    return $db;
}
function rh_input(): array {
    if (!str_starts_with(strtolower($_SERVER['CONTENT_TYPE'] ?? ''),'application/json')) rh_error(415,'content_type','JSON形式で送信してください。');
    if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0)>350000) rh_error(413,'too_large','送信内容が大きすぎます。');
    $body=file_get_contents('php://input',false,null,0,350001);
    if ($body===false || strlen($body)>350000) rh_error(413,'too_large','送信内容が大きすぎます。');
    try { $data=json_decode($body,true,32,JSON_THROW_ON_ERROR); } catch (JsonException) { rh_error(400,'invalid_json','送信内容を確認してください。'); }
    if (!is_array($data)) rh_error(400,'invalid_json','送信内容を確認してください。');
    return $data;
}
function rh_catalog(): array {
    $json=@file_get_contents(__DIR__.'/catalog.json');
    if ($json===false) throw new RuntimeException('Ranking chart catalog is missing');
    $catalog=json_decode($json,true,64,JSON_THROW_ON_ERROR);
    if (!is_array($catalog) || ($catalog['schemaVersion'] ?? null)!==1 || ($catalog['rulesVersion'] ?? null)!==RH_SCORE_RULES_VERSION || !is_array($catalog['songs'] ?? null) || !$catalog['songs']) throw new RuntimeException('Unsupported ranking chart catalog');
    return $catalog;
}
function rh_board_key(array $data, array $catalog): array {
    $song=$data['songId'] ?? null;$difficulty=$data['difficulty'] ?? null;$hash=$data['chartHash'] ?? null;
    if (!in_array($data['rulesVersion'] ?? null,[RH_SCORE_RULES_VERSION,(string)RH_SCORE_RULES_VERSION],true) || ($catalog['rulesVersion'] ?? null)!==RH_SCORE_RULES_VERSION
        || !is_string($song) || !isset($catalog['songs'][$song]) || !in_array($difficulty,['easy','normal','hard'],true)
        || !is_string($hash) || !preg_match('/^[a-f0-9]{64}$/D',$hash)) rh_error(400,'invalid_board','曲・難易度・譜面を確認してください。');
    return [hash('sha256',$song.'|'.$difficulty.'|'.$hash.'|rules'.RH_SCORE_RULES_VERSION),$song,$difficulty,$hash];
}
/** Trusted chart only. Box markers score as one note, just like the browser engine. */
function rh_notes(string $json): array {
    $chart=json_decode($json,true,64,JSON_THROW_ON_ERROR);$raw=$chart['notes'] ?? null;
    if (!is_array($raw) || !$raw || count($raw)>5000) throw new RuntimeException('Invalid chart');
    $ids=[];$boxes=[];
    foreach ($raw as $index=>$note) {
        $id=$note['id'] ?? null;$time=$note['time'] ?? null;$lane=$note['lane'] ?? null;
        if (!is_int($id) || $id<0 || $id>2147483647 || isset($ids[$id]) || (!is_int($time) && !is_float($time)) || !is_finite((float)$time) || $time<0
            || !is_int($lane) || $lane<0 || $lane>5 || !in_array($note['type'] ?? null,['tap','hold'],true)
            || !in_array($note['gimmick'] ?? '',['','dd','box','slide'],true)) throw new RuntimeException('Invalid chart note');
        $ids[$id]=true;
        if ($note['type']==='hold' && (!is_numeric($note['endTime'] ?? null) || !is_finite((float)$note['endTime']) || $note['endTime']<$time)) throw new RuntimeException('Invalid chart endpoint');
        if (($note['gimmick'] ?? '')==='box') {
            $box=$note['boxId'] ?? null;
            if (!is_int($box)) throw new RuntimeException('Invalid box');
            if (!isset($boxes[$box]) || $time<$raw[$boxes[$box]]['time']) $boxes[$box]=$index;
        }
    }
    return array_values(array_filter($raw,static fn($note,$i)=>($note['gimmick'] ?? '')!=='box' || $boxes[$note['boxId']]===$i,ARRAY_FILTER_USE_BOTH));
}
function rh_groups(array $notes): array {
    $membership=[];$groups=[];
    foreach ($notes as $note) { $membership[$note['id']]=$note['id'];$groups[$note['id']]=[$note['id']]; }
    $chords=array_values(array_filter($notes,static fn($note)=>!in_array($note['gimmick'] ?? '',['dd','box'],true)));
    usort($chords,static fn($a,$b)=>($a['time']<=>$b['time']) ?: ($a['lane']<=>$b['lane']));
    $group=[];
    $finish=static function() use (&$group,&$membership,&$groups): void {
        if (count(array_unique(array_column($group,'lane')))>1) {
            $id=$group[0]['id'];$groups[$id]=array_column($group,'id');
            foreach ($group as $note) $membership[$note['id']]=$id;
        }
    };
    foreach ($chords as $note) {
        if ($group && $note['time']-$group[0]['time']>0.001+1e-8) { $finish();$group=[]; }
        $group[]=$note;
    }
    $finish();return [$membership,$groups];
}
/** Integrate the authored tempo map; the origin cancels when measuring a hold. */
function rh_beat(array $chart, float $time): float {
    $start=(float)($chart['beatOrigin'] ?? $chart['startTime']);$bpm=(float)$chart['bpm'];$beat=0.0;
    if (!is_finite($bpm) || $bpm<=0) throw new RuntimeException('Invalid chart tempo');
    foreach ($chart['tempoChanges'] ?? [] as $change) {
        if ($change['time']>$time) break;
        $beat+=($change['time']-$start)*$bpm/60;$start=(float)$change['time'];$bpm=(float)$change['bpm'];
        if (!is_finite($bpm) || $bpm<=0) throw new RuntimeException('Invalid chart tempo');
    }
    return $beat+($time-$start)*$bpm/60;
}
function rh_special_points(array $chart, array $note): int {
    if (($note['gimmick'] ?? '')==='box') return 1500;
    if (($note['gimmick'] ?? '')==='dd') return 450;
    $beats=$note['type']==='hold' ? max(0,(int)floor(rh_beat($chart,(float)$note['endTime'])-rh_beat($chart,(float)$note['time'])+1e-8)) : 0;
    return $beats*150+(($note['gimmick'] ?? '')==='slide' ? count($note['path'] ?? [])*450 : 0);
}
function rh_calculate(string $json, mixed $results): array {
    $notes=rh_notes($json);
    if (!is_array($results) || !array_is_list($results) || count($results)!==count($notes)) rh_error(422,'invalid_result','最後までプレイした結果だけ登録できます。');
    $known=array_fill_keys(array_column($notes,'id'),true);[$membership,$groups]=rh_groups($notes);
    $chart=json_decode($json,true,64,JSON_THROW_ON_ERROR);$special=[];
    foreach ($notes as $note) $special[$note['id']]=rh_special_points($chart,$note);
    $points=['PERFECT'=>1000,'GREAT'=>700,'GOOD'=>500,'MISS'=>0];$judged=[];$awarded=[];$basePoints=0;$comboPoints=0;$specialBonus=0;$steps=[];$combo=0;$max=0;
    foreach ($results as $result) {
        if (!is_array($result)) rh_error(422,'invalid_result','判定結果を確認できません。');
        $id=$result['id'] ?? null;$judgement=$result['judgement'] ?? null;
        if (!is_int($id) || !isset($known[$id]) || isset($judged[$id]) || !is_string($judgement) || !array_key_exists($judgement,$points)) rh_error(422,'invalid_result','判定結果を確認できません。');
        $judged[$id]=$judgement;$combo=$judgement==='MISS' ? 0 : $combo+1;$max=max($max,$combo);
        $steps[$id]=min(10,intdiv($combo,10));
        $groupId=$membership[$id];
        if (!isset($awarded[$groupId])) {
            $sum=0;$complete=true;
            foreach ($groups[$groupId] as $member) {
                if (!isset($judged[$member]) || $judged[$member]==='MISS') { $complete=false;break; }
                $sum+=$points[$judged[$member]];
            }
            if ($complete) {
                $basePoints+=$sum;
                foreach ($groups[$groupId] as $member) {
                    $comboPoints+=$points[$judged[$member]]*$steps[$member];
                    $specialBonus+=intdiv($special[$member]*$points[$judged[$member]],1000);
                }
                $awarded[$groupId]=true;
            }
        }
    }
    $baseScore=intdiv($basePoints*1000,count($notes));$comboBonus=intdiv($comboPoints*15,count($notes));
    return ['score'=>$baseScore+$comboBonus+$specialBonus,'maxCombo'=>$max,'baseScore'=>$baseScore,'comboBonus'=>$comboBonus,'specialBonus'=>$specialBonus];
}
function rh_publication(array $fields, string $song, string $videoId, string $difficulty, string $hash): ?string {
    $json=$fields['json']['stringValue'] ?? '';$version=(int)($fields['schemaVersion']['integerValue'] ?? 0);
    if (($fields['songId']['stringValue'] ?? '')!==$song || ($fields['videoId']['stringValue'] ?? '')!==$videoId
        || (int)($fields['revision']['integerValue'] ?? 0)<1
        || !($difficulty==='normal' ? $version===1 && !isset($fields['difficulty']) : $version===2 && ($fields['difficulty']['stringValue'] ?? '')===$difficulty)
        || !is_string($json) || strlen($json)>800000 || !hash_equals(hash('sha256',$json),$hash)) return null;
    $chart=json_decode($json,true,64,JSON_THROW_ON_ERROR);
    if (($chart['videoId'] ?? '')!==$videoId || !is_array($chart['notes'] ?? null) || count($chart['notes'])!==(int)($fields['noteCount']['integerValue'] ?? -1)) return null;
    return $json;
}
function rh_resolve(PDO $db, array $catalog, array $key): array {
    [$id,$song,$difficulty,$hash]=$key;
    $query=$db->prepare('SELECT * FROM rhythm_boards WHERE id=?');$query->execute([$id]);
    if ($board=$query->fetch()) return $board;
    $json=$catalog['songs'][$song]['charts'][$difficulty] ?? null;
    if (!is_string($json) || !hash_equals(hash('sha256',$json),$hash)) {
        $json=null;$firebase=$catalog['firebase'] ?? null;
        if ($firebase) {
            $path='publishedCharts/'.rawurlencode($song).($difficulty==='normal' ? '' : '/difficulties/'.$difficulty);
            $url='https://firestore.googleapis.com/v1/projects/'.rawurlencode($firebase['projectId']).'/databases/(default)/documents/'.$path.'?key='.rawurlencode($firebase['apiKey']);
            $context=stream_context_create(['http'=>['timeout'=>8,'follow_location'=>0],'ssl'=>['verify_peer'=>true,'verify_peer_name'=>true]]);
            $body=@file_get_contents($url,false,$context,0,2000000);
            if ($body!==false) {
                $fields=json_decode($body,true,64,JSON_THROW_ON_ERROR)['fields'] ?? [];
                $json=rh_publication($fields,$song,$catalog['songs'][$song]['videoId'],$difficulty,$hash);
            }
        }
    }
    if (!$json) rh_error(409,'chart_unavailable','譜面を確認できません。ページを読み込み直して再度プレイしてください。');
    $notes=rh_notes($json);$end=max(array_map(static fn($note)=>$note['type']==='hold' ? $note['endTime'] : $note['time'],$notes));
    $minimum=max(0,(int)floor($end-2));
    $insert=$db->prepare('INSERT IGNORE INTO rhythm_boards (id,song_id,difficulty,chart_hash,rules_version,chart_json,minimum_seconds) VALUES (?,?,?,?,?,?,?)');
    $insert->execute([$id,$song,$difficulty,$hash,RH_SCORE_RULES_VERSION,$json,$minimum]);
    return ['id'=>$id,'chart_json'=>$json,'minimum_seconds'=>$minimum];
}
function rh_start(PDO $db, array $config, array $catalog, array $data): array {
    $key=rh_board_key($data,$catalog);$now=time();$bucket=(int)floor($now/60);
    $ip=hash_hmac('sha256',(string)($_SERVER['REMOTE_ADDR'] ?? ''),$config['db_password']);
    $rate=$db->prepare('INSERT INTO rhythm_rate_limits (ip_hash,bucket,hits) VALUES (?,?,1) ON DUPLICATE KEY UPDATE hits=hits+1');$rate->execute([$ip,$bucket]);
    $count=$db->prepare('SELECT hits FROM rhythm_rate_limits WHERE ip_hash=? AND bucket=?');$count->execute([$ip,$bucket]);
    if ((int)$count->fetchColumn()>30) rh_error(429,'rate_limit','開始操作が続いています。少し待ってから再度お試しください。');
    $board=rh_resolve($db,$catalog,$key);$token=bin2hex(random_bytes(32));
    $insert=$db->prepare('INSERT INTO rhythm_sessions (token_hash,board_id,issued_at,expires_at) VALUES (?,?,?,?)');$insert->execute([hash('sha256',$token),$key[0],$now,$now+7200]);
    $cleanup=$db->prepare('DELETE FROM rhythm_sessions WHERE expires_at<? LIMIT 100');$cleanup->execute([$now]);
    $cleanup=$db->prepare('DELETE FROM rhythm_rate_limits WHERE bucket<? LIMIT 100');$cleanup->execute([$bucket-120]);
    return ['token'=>$token,'expiresAt'=>$now+7200];
}
function rh_entry(array $row): array {
    return ['id'=>(string)$row['id'],'name'=>$row['name'],'score'=>(int)$row['score'],'maxCombo'=>(int)$row['max_combo'],'createdAt'=>(int)$row['created_at']];
}
function rh_submit(PDO $db, array $data): array {
    $token=$data['token'] ?? null;$name=$data['name'] ?? null;
    if (!is_string($token) || !preg_match('/^[a-f0-9]{64}$/D',$token)) rh_error(400,'invalid_token','このプレイの登録情報を確認できません。');
    if (!is_string($name) || !preg_match('/^[a-zA-Z0-9]{3,6}$/D',$name)) rh_error(422,'invalid_name','名前は半角英数字3〜6文字で入力してください。');
    $name=strtoupper($name);$tokenHash=hash('sha256',$token);
    $db->beginTransaction();
    try {
        $query=$db->prepare('SELECT * FROM rhythm_sessions WHERE token_hash=? FOR UPDATE');$query->execute([$tokenHash]);$session=$query->fetch();
        if (!$session || (int)$session['expires_at']<time()) rh_error(410,'expired','登録の有効期限が切れました。もういちどプレイしてください。');
        $query=$db->prepare('SELECT * FROM rhythm_boards WHERE id=?');$query->execute([$session['board_id']]);$board=$query->fetch();
        if ((int)$board['rules_version']!==RH_SCORE_RULES_VERSION) rh_error(409,'rules_changed','採点ルールが更新されました。ページを読み込み直して再度プレイしてください。');
        if (time()-(int)$session['issued_at']<(int)$board['minimum_seconds']) rh_error(422,'too_early','プレイ時間を確認できません。最後までプレイしてから登録してください。');
        $result=rh_calculate($board['chart_json'],$data['results'] ?? null);
        if (($data['score'] ?? null)!==$result['score'] || ($data['maxCombo'] ?? null)!==$result['maxCombo']) rh_error(422,'score_mismatch','判定結果と点数が一致しません。');
        $submission=hash('sha256',json_encode([$name,$data['results']],JSON_THROW_ON_ERROR));
        $query=$db->prepare('SELECT * FROM rhythm_entries WHERE token_hash=?');$query->execute([$tokenHash]);$entry=$query->fetch();
        if ($entry && !hash_equals($entry['submission_hash'],$submission)) rh_error(409,'already_submitted','このプレイはすでに登録済みです。');
        if (!$entry) {
            $query=$db->prepare('INSERT INTO rhythm_entries (board_id,token_hash,submission_hash,name,score,max_combo,created_at) VALUES (?,?,?,?,?,?,?)');
            $query->execute([$session['board_id'],$tokenHash,$submission,$name,$result['score'],$result['maxCombo'],time()]);
            $query=$db->prepare('SELECT * FROM rhythm_entries WHERE id=?');$query->execute([$db->lastInsertId()]);$entry=$query->fetch();
        }
        $db->commit();
        $query=$db->prepare('SELECT COUNT(*) FROM rhythm_entries WHERE board_id=? AND (score>? OR (score=? AND max_combo>?) OR (score=? AND max_combo=? AND id<?))');
        $query->execute([$entry['board_id'],$entry['score'],$entry['score'],$entry['max_combo'],$entry['score'],$entry['max_combo'],$entry['id']]);
        return ['entry'=>rh_entry($entry),'rank'=>1+(int)$query->fetchColumn()];
    } catch (Throwable $error) { if ($db->inTransaction()) $db->rollBack();throw $error; }
}
