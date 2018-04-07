class CreateClefCombinations < ActiveRecord::Migration[5.0]
  def change
    create_table :clef_combinations do |t|
      t.timestamps
    end

    create_table :voicings do |t|
      t.string :text
      t.timestamps
    end

    create_join_table :clef_combinations, :clefs do |t|
      t.index :clef_combination_id
      t.index :clef_id
      t.timestamps
    end

    create_join_table :clef_combinations, :voicings do |t|
      t.index :clef_combination_id
      t.index :voicing_id
      t.timestamps
    end
  end
end
