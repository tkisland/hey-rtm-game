<?php
declare(strict_types=1);
function rh_ip_in_range(string $ip,string $range): bool {
    $parts=explode('/',$range,2);$address=@inet_pton($ip);$network=@inet_pton($parts[0]);
    if($address===false||$network===false||strlen($address)!==strlen($network))return false;
    $bits=isset($parts[1])&&ctype_digit($parts[1])?(int)$parts[1]:(!isset($parts[1])?strlen($address)*8:-1);
    if($bits<0||$bits>strlen($address)*8)return false;
    $bytes=intdiv($bits,8);$rest=$bits%8;
    return substr($address,0,$bytes)===substr($network,0,$bytes)&&(!$rest||((ord($address[$bytes])^ord($network[$bytes]))&(255<<(8-$rest)))===0);
}
function rh_client_ip(array $config): string {
    $raw=$_SERVER['REMOTE_ADDR'] ?? '';$peer=filter_var($raw,FILTER_VALIDATE_IP)?inet_ntop(inet_pton($raw)):'unknown';
    $trusted=static function(string $ip) use($config):bool{foreach($config['trusted_proxies'] ?? [] as $range)if(is_string($range)&&rh_ip_in_range($ip,$range))return true;return false;};
    if(!$trusted($peer))return $peer;
    $header=$_SERVER['HTTP_X_FORWARDED_FOR'] ?? '';if(!is_string($header)||strlen($header)>1024)return $peer;
    $chain=array_map('trim',explode(',',$header));if(count($chain)>20)return $peer;
    foreach($chain as $ip)if(!filter_var($ip,FILTER_VALIDATE_IP))return $peer;
    for($i=count($chain)-1;$i>=0;$i--)if(!$trusted($chain[$i]))return inet_ntop(inet_pton($chain[$i]));
    return $peer;
}
function rh_rate_key(array $config): string {
    if(isset($config['rate_limit_key'])){
        if(!is_string($config['rate_limit_key'])||!preg_match('/^[a-f0-9]{64}$/Di',$config['rate_limit_key']))throw new RuntimeException('Invalid dedicated rate key');
        return hex2bin($config['rate_limit_key']);
    }
    $private=rh_config_path();if(!$private)throw new RuntimeException('Private rate key directory is missing');
    $dir=dirname($private);$path=$dir.'/rate-limit.key';
    $lock=@fopen($dir.'/.rate-key.lock','c');if(!$lock)throw new RuntimeException('Cannot create private rate key lock');
    try{
        if(!flock($lock,LOCK_EX))throw new RuntimeException('Cannot lock private rate key');
        if(is_link($path))throw new RuntimeException('Rate key must be a regular private file');
        if(is_file($path))$key=trim((string)file_get_contents($path));
        else{
            $key=bin2hex(random_bytes(32));$temp=tempnam($dir,'rate-key-');if($temp===false)throw new RuntimeException('Cannot create private rate key');
            try{if(file_put_contents($temp,$key)!==64||!chmod($temp,0600)||!rename($temp,$path))throw new RuntimeException('Cannot save private rate key');}
            finally{if(is_file($temp))unlink($temp);}
        }
        if(!preg_match('/^[a-f0-9]{64}$/D',$key))throw new RuntimeException('Invalid stored rate key');
        return hex2bin($key);
    }finally{flock($lock,LOCK_UN);fclose($lock);}
}
function rh_rate_limit(PDO $db,array $config,string $purpose,int $limit): void {
    $bucket=(int)floor(time()/60);$identity=hash_hmac('sha256',$purpose.'|'.rh_client_ip($config),rh_rate_key($config));
    $rate=$db->prepare('INSERT INTO rhythm_rate_limits (ip_hash,bucket,hits) VALUES (?,?,1) ON DUPLICATE KEY UPDATE hits=hits+1');$rate->execute([$identity,$bucket]);
    $q=$db->prepare('SELECT hits FROM rhythm_rate_limits WHERE ip_hash=? AND bucket=?');$q->execute([$identity,$bucket]);
    if((int)$q->fetchColumn()>$limit)rh_error(429,'rate_limit','操作が続いています。少し待ってから再試行してください。');
}
