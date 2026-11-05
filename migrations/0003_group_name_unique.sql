-- 分组名唯一：并发创建可能产生重名分组，重名还会让该实例的备份被恢复端
-- duplicate_group 拒收（restore.validate 不接受备份内重名）。
-- 先给历史重名分组追加随机后缀（截断原名，避免撞上已有的「名称 #id」），再建唯一索引。

UPDATE groups
   SET name = substr(name, 1, 60) || ' #' || id || '-' || lower(hex(randomblob(3)))
 WHERE id NOT IN (SELECT MIN(id) FROM groups GROUP BY name);

CREATE UNIQUE INDEX idx_groups_name ON groups (name);
