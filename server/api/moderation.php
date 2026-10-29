<?php
declare(strict_types=1);
require __DIR__.'/moderation-core.php';
header('Content-Type: application/json; charset=utf-8');header('Cache-Control: no-store');header('X-Content-Type-Options: nosniff');
try{
    if(($_SERVER['REQUEST_METHOD'] ?? '')!=='POST')rh_error(405,'method','この操作方法は利用できません。');
    $config=rh_config();if(!$config)rh_error(503,'admin_setup','ランキングの管理機能を準備中です。');
    if(($_SERVER['HTTP_ORIGIN'] ?? '')!==($config['allowed_origin'] ?? 'https://hey.jpn.org'))rh_error(403,'origin','このサイトから操作してください。');
    $data=rh_input();$auth=$_SERVER['HTTP_AUTHORIZATION'] ?? '';
    $token=$data['idToken'] ?? (preg_match('/^Bearer ([A-Za-z0-9_.-]{1,8192})$/D',$auth,$match)?$match[1]:null);
    if(!is_string($token)||strlen($token)>8192)rh_error(401,'admin_login','Googleで管理者ログインしてください。');
    $catalog=rh_catalog();$db=rh_db($config);
    rh_rate_limit($db,$config,'admin-auth',max(1,min(300,(int)($config['admin_limit_per_minute'] ?? 60))));
    $uid=rm_require_admin($catalog,$token);
    if(!rm_ready($db))rh_error(503,'moderation_setup','管理機能の追加SQLを実行してください。');
    $result=match($data['action'] ?? ''){'list'=>rm_list($db,$catalog,$data),'history'=>rm_history($db,$data),'hide'=>rm_change($db,$uid,$data,true),'restore'=>rm_change($db,$uid,$data,false),default=>throw new RankingError(400,'invalid_action','操作を確認してください。')};
    echo json_encode(['ok'=>true]+$result,JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR);
}catch(RankingError $error){http_response_code($error->httpStatus);echo json_encode(['ok'=>false,'code'=>$error->errorCode,'message'=>$error->getMessage()],JSON_UNESCAPED_UNICODE);}
catch(Throwable $error){error_log('Rhythm moderation: '.$error->getMessage());http_response_code(503);echo json_encode(['ok'=>false,'code'=>'admin_unavailable','message'=>'管理機能を利用できません。少し待って再試行してください。'],JSON_UNESCAPED_UNICODE);}
