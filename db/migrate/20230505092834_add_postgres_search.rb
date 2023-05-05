class AddPostgresSearch < ActiveRecord::Migration[6.1]
  CLASSES = {
    Attribution => %i[text],
    Group => %i[display_title],
    Title => %i[text],
    Composer => %i[name],
    Source => %i[title code location_and_pubscribe dates type],
    Edition => %i[voicing file_url],
    Editor => %i[name],
    Performer => %i[name],
    Recording => %i[file_url],
  }.freeze

  def up
    CLASSES.each do |klass, columns|
      column_concat = columns.map { |column| "COALESCE(#{column}, '')" }.join(" || ' ' || ")

      execute <<-SQL
        ALTER TABLE #{klass.table_name}
        DROP COLUMN IF EXISTS search_vector,
        ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
          setweight(to_tsvector('english', #{column_concat}), 'A')
        ) STORED;
      SQL

      execute <<-SQL
        DROP INDEX IF EXISTS search_vector_index;
        CREATE INDEX search_vector_index ON #{klass.table_name} USING gin(search_vector);
      SQL
    end
  end

  def down
    CLASSES.each do |klass, _columns|
      execute <<-SQL
        DROP INDEX IF EXISTS search_vector_index;
      SQL

      execute <<-SQL
        ALTER TABLE #{klass.table_name}
        DROP COLUMN IF EXISTS search_vector;
      SQL
    end
  end
end
