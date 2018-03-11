class CreateFunction < ActiveRecord::Migration[5.0]
  def change
    create_table :functions do |t|
      t.string :name
      t.timestamps
    end

    create_join_table :functions, :titles do |t|
      t.index [:function_id, :title_id]
    end
  end
end
