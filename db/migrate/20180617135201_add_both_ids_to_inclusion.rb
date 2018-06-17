class AddBothIdsToInclusion < ActiveRecord::Migration[5.0]
  def change
    add_column :inclusions, :both_clef_ids, :integer, array: true, nil: false, default: []
  end
end
