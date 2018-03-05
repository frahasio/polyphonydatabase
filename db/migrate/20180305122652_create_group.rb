class CreateGroup < ActiveRecord::Migration[5.0]
  def change
    create_table :groups do |t|
      t.string :display_title
      t.timestamps
    end

    add_belongs_to :recordings, :group
    add_belongs_to :editions, :group
  end
end
