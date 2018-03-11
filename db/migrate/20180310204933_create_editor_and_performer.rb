class CreateEditorAndPerformer < ActiveRecord::Migration[5.0]
  def change
    create_table :editors do |t|
      t.string :name
      t.date :date_of_birth
      t.timestamps
    end

    create_table :performers do |t|
      t.string :name
      t.timestamps
    end

    rename_column :editions, :editor, :editor_name
    rename_column :recordings, :performer, :performer_name

    add_belongs_to :editions, :editor
    add_belongs_to :recordings, :performer
  end
end
