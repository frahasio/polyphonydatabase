class AddTransitionsTo < ActiveRecord::Migration[5.0]
  def change
    add_column :inclusions, :transitions_to, :json
  end
end
