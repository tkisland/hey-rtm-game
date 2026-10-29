<?php
// Test-only TLS services. Certificate/private key are ephemeral and not deployed.
$context=stream_context_create(['ssl'=>['local_cert'=>__DIR__.'/ca.pem','local_pk'=>__DIR__.'/key.pem','verify_peer'=>false]]);
$server=stream_socket_server('tls://0.0.0.0:443',$errno,$error,STREAM_SERVER_BIND|STREAM_SERVER_LISTEN,$context);if(!$server)throw new RuntimeException($error);
while(true){
    $client=@stream_socket_accept($server,30);if(!$client)continue;stream_set_timeout($client,3);
    try{
        $text='';while(!str_contains($text,"\r\n\r\n")&&strlen($text)<20000){$chunk=fread($client,8192);if($chunk===false||$chunk==='')break;$text.=$chunk;}
        [$headers,$body]=array_pad(explode("\r\n\r\n",$text,2),2,'');
        preg_match('/^Content-Length:\s*(\d+)/mi',$headers,$length);$length=(int)($length[1] ?? 0);
        while(strlen($body)<$length){$chunk=fread($client,$length-strlen($body));if($chunk===false||$chunk==='')break;$body.=$chunk;}
        preg_match('~^\S+ (\S+)~',$headers,$match);$path=parse_url($match[1] ?? '',PHP_URL_PATH);$status=400;$result=['error'=>'invalid token'];
        if($path==='/v1/accounts:lookup')$token=json_decode($body,true)['idToken'] ?? '';
        else{preg_match('/^Authorization: Bearer ([^\r\n]+)/mi',$headers,$auth);$token=$auth[1] ?? '';}
        $parts=explode('.',$token);$decode=static fn($s)=>base64_decode(strtr($s,'-_','+/'),true);
        $claims=count($parts)===3?json_decode($decode($parts[1]),true):null;
        $valid=is_array($claims)&&openssl_verify($parts[0].'.'.$parts[1],$decode($parts[2]),file_get_contents(__DIR__.'/ca.pem'),OPENSSL_ALGO_SHA256)===1&&($claims['aud'] ?? '')==='admin-test'&&($claims['exp'] ?? 0)>time();
        if($valid){
            $state=json_decode(file_get_contents(__DIR__.'/state.json'),true);$uid=$claims['sub'];
            if($path==='/v1/accounts:lookup'){$status=200;$result=['users'=>[['localId'=>$uid,'emailVerified'=>$claims['email_verified'],'disabled'=>$state['disabled'],'validSince'=>(string)$state['validSince']]]];}
            elseif($path==='/v1/projects/admin-test/databases/(default)/documents/admins/'.$uid){$status=200;$result=['fields'=>['enabled'=>['booleanValue'=>$uid==='owner'&&$state['enabled']]]];}
        }
        $output=json_encode($result);fwrite($client,"HTTP/1.1 $status Test\r\nContent-Type: application/json\r\nContent-Length: ".strlen($output)."\r\nConnection: close\r\n\r\n".$output);
    }catch(Throwable $e){fwrite($client,"HTTP/1.1 500 Error\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}");}
    fclose($client);
}
