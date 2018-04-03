class RenameRefersTo < ActiveRecord::Migration[5.0]
  def change
    rename_column :attributions, :refers_to, :refers_to_id
  end
end
