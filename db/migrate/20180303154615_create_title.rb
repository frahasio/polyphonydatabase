class CreateTitle < ActiveRecord::Migration[5.0]
  def change
    create_table :titles do |t|
      t.string :text
      t.timestamps
    end
  end
end
