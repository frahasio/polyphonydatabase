class CreateVoice < ActiveRecord::Migration[7.1]
  def change
    create_table :voices do |t|
      t.boolean :optional, null: false, default: false
      t.references :composition, null: false, foreign_key: true

      t.timestamps
    end
  end
end
