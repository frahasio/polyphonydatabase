class ExtractPublishersEtc < ActiveRecord::Migration[5.0]
  def change
    create_table :publishers do |t|
      t.string :name
      t.timestamps
    end

    create_join_table :publishers, :sources do |t|
      t.index :publisher_id
      t.index :source_id
    end

    create_table :scribes do |t|
      t.string :name
      t.timestamps
    end

    create_join_table :scribes, :sources do |t|
      t.index :scribe_id
      t.index :source_id
    end
  end
end
