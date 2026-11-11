-- План 2б: ИИН/БИН исполнителя хранит identity (шифртекст с kid), web пишет только проекцию (последние 4 цифры).
-- Столбец больше не заполняется; удаление — план 7.
ALTER TABLE "ExecutorProfile" ALTER COLUMN "binIinEnc" DROP NOT NULL;
