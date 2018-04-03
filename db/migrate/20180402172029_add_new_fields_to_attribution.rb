class AddNewFieldsToAttribution < ActiveRecord::Migration[5.0]
  def change
    add_column :attributions, :text, :string
    add_column :attributions, :refers_to, :integer
  end
end
