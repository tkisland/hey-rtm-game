<?php
declare(strict_types=1);
require __DIR__.'/core.php';
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
try {
    $action=$_GET['action'] ?? '';$method=$_SERVER['REQUEST_METHOD'] ?? 'GET';
    if (!in_array($action,['status','start','submit','share','leaderboard'],true)) rh_error(404,'not_found','ランキングの操作が見つかりません。');
    $post=in_array($action,['start','submit','share'],true);
    if ($method!==($post ? 'POST' : 'GET')) rh_error(405,'method','この操作方法は利用できません。');
    $config=rh_config();
    if ($action==='status') {
        $enabled=false;
        if ($config) { try { rh_db($config);rh_catalog();$enabled=true; } catch (Throwable $error) { error_log('Rhythm ranking: '.$error->getMessage()); } }
        echo json_encode(['ok'=>true,'enabled'=>$enabled]);exit;
    }
    if (!$config) rh_error(503,'not_configured','ランキングは準備中です。');
    if ($post && ($_SERVER['HTTP_ORIGIN'] ?? '')!==($config['allowed_origin'] ?? 'https://hey.jpn.org')) rh_error(403,'origin','このサイトから登録してください。');
    $db=rh_db($config);$catalog=rh_catalog();
    if ($action==='start') $result=rh_start($db,$config,$catalog,rh_input());
    elseif ($action==='share') {
        if(!rh_has_shared_results($db))rh_error(503,'share_setup','共有機能を準備中です。');
        $result=rh_share($db,$catalog,rh_input());
        require_once __DIR__.'/../share-common.php';
        $image=rs_cached_image(rs_result(['id'=>$result['id']],$db));fclose($image);
    }
    elseif ($action==='submit') $result=rh_submit($db,rh_input());
    else {
        [$id]=rh_board_key($_GET,$catalog);
        $query=$db->prepare('SELECT id,name,score,max_combo,created_at FROM rhythm_entries WHERE board_id=? ORDER BY score DESC,max_combo DESC,id ASC LIMIT 20');$query->execute([$id]);
        $result=['entries'=>array_map('rh_entry',$query->fetchAll())];
    }
    echo json_encode(['ok'=>true]+$result,JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR);
} catch (RankingError $error) {
    http_response_code($error->httpStatus);echo json_encode(['ok'=>false,'code'=>$error->errorCode,'message'=>$error->getMessage()],JSON_UNESCAPED_UNICODE);
} catch (Throwable $error) {
    error_log('Rhythm ranking: '.$error->getMessage());http_response_code(503);
    echo json_encode(['ok'=>false,'code'=>'unavailable','message'=>'ランキングに接続できません。少し待ってから再度お試しください。'],JSON_UNESCAPED_UNICODE);
}
