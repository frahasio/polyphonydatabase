class MakeTitleTextUnique < ActiveRecord::Migration[5.0]
  def change
    add_index :titles, :text, unique: true
  end
end
