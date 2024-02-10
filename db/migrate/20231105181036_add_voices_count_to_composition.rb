class AddVoicesCountToComposition < ActiveRecord::Migration[7.1]
  def change
    add_column :compositions, :voices_count, :integer, null: false, default: 0
  end
end
