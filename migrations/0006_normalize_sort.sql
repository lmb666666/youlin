-- 历史数据可能写入负排序位；备份 schema 要求 sort >= 0，统一夹到 0。
UPDATE groups SET sort = 0 WHERE sort < 0;
UPDATE friends SET sort = 0 WHERE sort < 0;
